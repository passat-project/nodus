import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { snapDevicePx, uiPx } from '../../../shared/ui/ui-scale.js';
import { centerAtPoint, zoomAtPoint } from '../lib/canvas-view.js';
import type { DepartmentCardStats } from '../lib/department-card-stats.js';
import { departmentTrail } from '../lib/department-tree.js';
import { useCanvasView } from '../lib/use-canvas-view.js';
import { useStructureExpansion } from '../lib/use-structure-expansion.js';
import { useTreeEdges, type TreeLink } from '../lib/use-tree-edges.js';
import { StructureDots } from './structure-dots.js';
import { StructureNode } from './structure-node.js';
import { StructureTrace } from './structure-trace.js';

/** Ширина постоянной правой панели (w-80) в дизайн-px: канвас резервирует её
 *  ВСЕГДА (панель не выезжает и не скрывается — модель Битрикса, вердикт
 *  13.11.2026), поэтому дерево не дёргается при выборе отдела. */
const PANEL_INSET_PX = uiPx(320);

/** Запрос центрирования: id узла или null — центрировать корни. */
export interface StructureFocus {
  id: string | null;
  /** Новая метка = новый запрос (повторный выбор того же узла тоже центрирует). */
  token: number;
}

/**
 * Вид «Структура» (#768, вердикты владельца 12–16.11.2026): канвас дерева
 * карточек-отделов в грамматике контура. Раскладка — ФИКСИРОВАННЫЕ
 * СЛОТЫ: слот узла равен карточке, ряд детей — абсолютный слой под родителем,
 * поэтому раскрытие не двигает карточки других уровней. Раскрытие —
 * АККОРДЕОН ПО УРОВНЯМ, как в Битриксе: главная карточка и её прямые
 * отделы видны по умолчанию; на каждом следующем уровне раскрыт один
 * узел — цепочка от главной карточки к выбранному. Клик по соседу на уровне
 * закрывает прежнюю ветку, клик по уже раскрытому предку глубокие уровни НЕ
 * закрывает, клик по выбранному — no-op. Шеврон футера сворачивает ветку
 * целиком и переносит выбор на свою карточку, если выбранный был внутри.
 * Маршрут к выбранному подсвечивается (предки — тон маршрута, выбранная —
 * толстый контур с кольцом), по нему бежит точка-импульс со следом
 * (`StructureTrace`). Полотно двигается как в редакторе: Ctrl/⌘+колесо — зум к
 * курсору, колесо — панорама, ЛКМ по пустому месту — перетаскивание; текст на
 * карточках при этом не выделяется. Центрирование — ТОЛЬКО по явному запросу
 * (вход на вкладку, выбор из поиска): раскрытие, шеврон, выбор отдела и
 * сброс масштаба экран не двигают (сброс возвращает 100% ВОКРУГ ЦЕНТРА, вердикт
 * 17.11.2026). Фон — точечная сетка как в
 * автоматизации (`StructureDots`): живёт во вьюпорте и едет с полотном;
 * «Найти меня» слева от масштаба выбирает меня через поиск (вердикт
 * 16.11.2026).
 */
export function DivisionsView({
  roots,
  selectedId,
  mainId,
  myDepartmentId,
  focus,
  canManage,
  statsById,
  onSelect,
  onCreateChild,
  onInvite,
  onEdit,
  onLocateMe,
}: {
  roots: DepartmentNode[];
  selectedId: string | null;
  /** Главная карточка компании (первый корень дерева). */
  mainId: string | null;
  /** Мой активный отдел — бейдж «Ваше подразделение» на карточке. */
  myDepartmentId: string | null;
  focus: StructureFocus | null;
  canManage: boolean;
  /** Данные карточек (руководитель, замы, подчинённые, чип) — считает страница. */
  statsById: ReadonlyMap<string, DepartmentCardStats>;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  /** «⋯» карточки: приглашение в Nodus с предвыбранным подразделением (#101). */
  onInvite: (node: DepartmentNode) => void;
  /** «⋯» карточки: правка отдела (полное меню действий — #881). */
  onEdit: (node: DepartmentNode) => void;
  /** «Найти меня»: выбор себя через поиск (нет обработчика — нет кнопки). */
  onLocateMe?: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [pendingCenter, setPendingCenter] = useState<StructureFocus | null>(null);
  const { view, setView, panning, handlers } = useCanvasView(viewportRef);
  /** Раскрытие/шеврон/выбор и контуры маршрута — отдельный хук
   *  (`lib/use-structure-expansion.ts`): канвас держит раскладку и полотно. */
  const { expandedIds, routeIds, childrenOf, selectNode, toggleNode } = useStructureExpansion({
    roots,
    selectedId,
    mainId,
    onSelect,
  });

  // Центрирование — только по явному запросу (вход/поиск/сброс масштаба).
  useEffect(() => {
    if (focus) setPendingCenter(focus);
  }, [focus]);

  // Полотно живёт в transform, поэтому сдвигаем view на дельту между текущим
  // центром цели и центром свободной части вьюпорта (работает при любом
  // масштабе: rects уже отмасштабированы).
  useLayoutEffect(() => {
    if (!pendingCenter) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const box = viewport.getBoundingClientRect();
    const free = { width: Math.max(0, box.width - PANEL_INSET_PX), height: box.height };
    const targets = pendingCenter.id
      ? [nodeRefs.current.get(pendingCenter.id)].filter(
          (el): el is HTMLDivElement => el !== undefined,
        )
      : roots
          .map((node) => nodeRefs.current.get(node.id))
          .filter((el): el is HTMLDivElement => el !== undefined);
    if (targets.length === 0) {
      setPendingCenter(null);
      return;
    }
    const rects = targets.map((element) => element.getBoundingClientRect());
    const center = rects.reduce(
      (acc, rect) => ({
        x: acc.x + (rect.left + rect.width / 2 - box.left) / rects.length,
        y: acc.y + (rect.top + rect.height / 2 - box.top) / rects.length,
      }),
      { x: 0, y: 0 },
    );
    setView((current) => centerAtPoint(current, center, free));
    setPendingCenter(null);
  }, [pendingCenter, roots, setView]);

  const links = useMemo(() => {
    const list: TreeLink[] = [];
    const walk = (nodes: DepartmentNode[]) => {
      for (const node of nodes) {
        const children = childrenOf(node);
        for (const child of children) list.push({ parent: node.id, child: child.id });
        walk(children);
      }
    };
    walk(roots);
    return list;
  }, [roots, childrenOf]);

  const { segments, ports, routes, portRadius } = useTreeEdges(rootRef, nodeRefs, links, view.zoom);

  const trail = useMemo(
    () => (selectedId ? departmentTrail(roots, selectedId) : []),
    [roots, selectedId],
  );
  /** Новый ключ = новый пробег следа: смена выбора или повторный выбор из
   *  поиска (focus.token), клики по карточкам экран не двигают. */
  const traceKey = `${selectedId ?? ''}:${focus?.token ?? 0}`;

  /** Сброс масштаба — НА МЕСТЕ: 100% вокруг центра свободной части вьюпорта
   *  (без панели). Выбор, поиск и центрирование не запускаются (вердикт
   *  17.11.2026): «вернуться к 100%» — про масштаб, а не про навигацию. */
  function resetView() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const box = viewport.getBoundingClientRect();
    const free = { width: Math.max(0, box.width - PANEL_INSET_PX), height: box.height };
    setView((current) => zoomAtPoint(current, 1, { x: free.width / 2, y: free.height / 2 }));
  }

  // Панорама — на сетку устройства: снап рёбер считается от экранной
  // координаты (`snapBoard`), и дробный сдвиг уводил бы фазу сетки при драге
  // (линии «плавают» на дробных зумах). Точки фона едут тем же сдвигом.
  const panX = snapDevicePx(view.x);
  const panY = snapDevicePx(view.y);

  return (
    <div
      ref={viewportRef}
      data-structure-canvas
      className={cn(
        // overflow-clip, НЕ overflow-hidden: hidden остаётся скролл-контейнером,
        // и фокус на кнопке карточки авто-скроллит полотно при росте ветки —
        // «экран уезжает» на половину прибавки (репро #768, 15.11.2026).
        'relative h-full touch-none overflow-clip select-none',
        panning ? 'cursor-grabbing' : 'cursor-grab',
      )}
      onDragStart={(event) => event.preventDefault()}
      {...handlers}
    >
      <StructureDots x={panX} y={panY} zoom={view.zoom} />
      <div
        data-structure-canvas-content
        className="absolute top-0 left-0 w-full origin-top-left"
        style={{ transform: `translate3d(${panX}px, ${panY}px, 0) scale(${view.zoom})` }}
      >
        {/* Ширина = вьюпорт, а не контент: раскрытие ветки не перецентрирует
            всё дерево (иначе карточки «прыгают» на месте). */}
        <div
          ref={rootRef}
          data-structure-root
          style={{ paddingRight: PANEL_INSET_PX }}
          className="relative w-full py-12"
        >
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            {segments.map((segment) => (
              <path
                key={segment.key}
                d={segment.d}
                fill="none"
                stroke="var(--edge)"
                strokeWidth={1}
              />
            ))}
            {ports.map((port) => (
              <circle key={port.key} cx={port.x} cy={port.y} r={portRadius} fill="var(--port)" />
            ))}
            <StructureTrace routes={routes} trail={trail} runKey={traceKey} />
          </svg>
          <div className="flex justify-center gap-6 px-6">
            {roots.map((node) => (
              <StructureNode
                key={node.id}
                node={node}
                depth={0}
                mainId={mainId}
                myDepartmentId={myDepartmentId}
                selectedId={selectedId}
                routeIds={routeIds}
                expandedIds={expandedIds}
                canManage={canManage}
                childrenOf={childrenOf}
                statsById={statsById}
                nodeRefs={nodeRefs}
                onSelect={selectNode}
                onToggle={toggleNode}
                onCreateChild={onCreateChild}
                onInvite={onInvite}
                onEdit={onEdit}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        {onLocateMe ? (
          <button
            type="button"
            onClick={onLocateMe}
            title={ui.employees.locateMe}
            aria-label={ui.employees.locateMe}
            data-locate-me
            className="flex size-7 items-center justify-center rounded-lg border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
          >
            <LocateFixed className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={resetView}
          title={ui.employees.zoomReset}
          aria-label={ui.employees.zoomReset}
          className="rounded-lg border border-border bg-card/90 px-2 py-1 font-mono text-label-sm text-muted-foreground tabular-nums shadow-sm backdrop-blur transition-colors hover:text-foreground"
        >
          {Math.round(view.zoom * 100)}%
        </button>
      </div>
    </div>
  );
}
