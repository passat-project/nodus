import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DepartmentNode } from '@nodus/contracts';

import { departmentPath, keepChain } from './department-tree.js';

/** Стабильная пустая ветка (не создавать массив каждый рендер). */
const EMPTY_CHILDREN: DepartmentNode[] = [];

/**
 * Раскрытие и выбор в структуре отделов (#768, пакет 16.11.2026):
 * аккордеон по уровням (модель Битрикса) + шеврон-сворачивание ветки.
 *
 * Цепочка раскрытий: индекс — глубина узла, значение — раскрытый на этом
 * уровне узел. Клик по соседу на уровне закрывает прежнюю ветку, клик по уже
 * раскрытому предку глубокие уровни НЕ закрывает, клик по выбранной раскрытой
 * карточке — no-op. Шеврон футера сворачивает ветку целиком (дети и все уровни
 * глубже), повторное раскрытие открывает один уровень; если внутри стоял
 * выбранный отдел, выбор и панель переходят на карточку шеврона.
 * `routeIds` — путь «главная → выбранное» для контуров предков. Внешний выбор
 * (вход на вкладку, поиск, архивация) раскрывает путь и снимает шеврон-свёртки
 * с предков: выбранное обязано быть видно.
 */
export function useStructureExpansion({
  roots,
  selectedId,
  mainId,
  onSelect,
}: {
  roots: DepartmentNode[];
  selectedId: string | null;
  mainId: string | null;
  onSelect: (id: string) => void;
}): {
  expandedIds: ReadonlySet<string>;
  routeIds: ReadonlySet<string>;
  childrenOf: (node: DepartmentNode) => DepartmentNode[];
  selectNode: (id: string) => void;
  toggleNode: (id: string) => void;
} {
  /** Цепочка раскрытий: инициализируется путём к выбранному — вход без мигания. */
  const [chain, setChain] = useState<string[]>(() =>
    selectedId ? (departmentPath(roots, selectedId)?.map((node) => node.id) ?? []) : [],
  );
  /** Явно свёрнутые шевроном ветки: дети (и все уровни глубже) не видны,
   *  даже если узел остался в цепочке раскрытий. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** Клик по карточке сам задал раскрытие — внешняя синхронизация его не
   *  перетирает (иначе клик по предку срезал бы глубокие уровни). */
  const internalSelect = useRef<string | null>(null);
  const syncedSelection = useRef<string | null | undefined>(selectedId);

  const depthById = useMemo(() => {
    const map = new Map<string, number>();
    const walk = (nodes: DepartmentNode[], depth: number) => {
      for (const node of nodes) {
        map.set(node.id, depth);
        walk(node.children, depth + 1);
      }
    };
    walk(roots, 0);
    return map;
  }, [roots]);

  // Внешний выбор (вход, поиск, смена после архивации) раскрывает путь до
  // цели; рефетч дерева цепочку не трогает.
  useEffect(() => {
    if (syncedSelection.current === selectedId) return;
    syncedSelection.current = selectedId;
    if (selectedId !== null && internalSelect.current === selectedId) {
      internalSelect.current = null;
      return;
    }
    internalSelect.current = null;
    const path = selectedId ? departmentPath(roots, selectedId) : null;
    if (path) {
      setCollapsed((prev) => {
        if (!path.some((node) => prev.has(node.id))) return prev;
        const next = new Set(prev);
        for (const node of path) next.delete(node.id);
        return next;
      });
    }
    setChain(path ? path.map((node) => node.id) : []);
  }, [selectedId, roots]);

  // Главная карточка раскрыта по умолчанию; шеврон может свернуть и её.
  const expandedIds = useMemo(() => {
    const set = new Set<string>(chain);
    if (mainId) set.add(mainId);
    for (const id of collapsed) set.delete(id);
    return set;
  }, [mainId, chain, collapsed]);

  /** Путь «главная → выбранное»: контуры предков и перенос выбора при
   *  сворачивании ветки, внутри которой стоял выбранный отдел. */
  const routeIds = useMemo(
    () =>
      new Set(selectedId ? (departmentPath(roots, selectedId)?.map((node) => node.id) ?? []) : []),
    [roots, selectedId],
  );

  const childrenOf = useCallback(
    (node: DepartmentNode): DepartmentNode[] =>
      node.children.length > 0 && expandedIds.has(node.id) ? node.children : EMPTY_CHILDREN,
    [expandedIds],
  );

  /** Раскрыть узел и выбрать его (тело карточки и шеврон свёрнутой ветки). */
  function openNode(id: string) {
    const depth = depthById.get(id);
    if (depth === undefined) return;
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setChain((current) => keepChain(current, depth, id));
    if (id === selectedId) return;
    internalSelect.current = id;
    onSelect(id);
  }

  /** Клик по телу карточки: выбрать и раскрыть. Повторный клик по выбранной —
   *  ничего, если она раскрыта; свёрнутую шевроном — раскрывает. */
  function selectNode(id: string) {
    if (id === selectedId) {
      if (collapsed.has(id)) openNode(id);
      return;
    }
    openNode(id);
  }

  /** Шеврон футера: раскрытая ветка сворачивается целиком, свёрнутая —
   *  раскрывается одним уровнем и становится выбранной. */
  function toggleNode(id: string) {
    const depth = depthById.get(id);
    if (depth === undefined) return;
    if (!expandedIds.has(id)) {
      openNode(id);
      return;
    }
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Глубокие уровни уходят из цепочки: повторное раскрытие — один уровень.
    setChain((current) => current.slice(0, depth + 1));
    if (selectedId && selectedId !== id && routeIds.has(id)) {
      internalSelect.current = id;
      onSelect(id);
    }
  }

  return { expandedIds, routeIds, childrenOf, selectNode, toggleNode };
}
