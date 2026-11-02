import { ChevronDown, ChevronUp, Folder, UserRound, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { cn } from '@nodus/ui/lib/utils';

import { filterTreeByName, totalEmployees } from '../lib/department-tree.js';
import { useTreeEdges, type TreeLink } from '../lib/use-tree-edges.js';

/**
 * Вид «Подразделения» (#84, референс — дерево карточек отделов Битрикса):
 * канвас дерева карточек-подразделений в грамматике контура (node-панели,
 * ортогональные рёбра use-tree-edges, snapPx). Карточка = подразделение
 * (название, руководитель, счётчики сотрудников с подподразделами и подотделов),
 * клик — правая панель подразделения; шеврон — свернуть/развернуть подотделы
 * (дефолт: свёрнуто от 3-го уровня — сотни людей не бывают на канвасе ВООБЩЕ).
 * Поиск фильтрует ветки. Рёбра следуют только за РАСКРЫТЫМИ узлами.
 */
export function DivisionsView({
  roots,
  selectedId,
  onSelect,
  query,
}: {
  roots: DepartmentNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const searching = query.trim().length > 0;
  const visible = useMemo(() => filterTreeByName(roots, query), [roots, query]);

  // Дефолт свёрнутости — узлы глубже 2-го уровня (корень + отделы видны сразу).
  useEffect(() => {
    const deep = new Set<string>();
    const walk = (nodes: DepartmentNode[], depth: number) => {
      for (const node of nodes) {
        if (depth >= 2 && node.children.length > 0) deep.add(node.id);
        walk(node.children, depth + 1);
      }
    };
    walk(roots, 0);
    setCollapsed(deep);
  }, [roots]);

  const links = useMemo(() => {
    const list: TreeLink[] = [];
    const walk = (nodes: DepartmentNode[]) => {
      for (const node of nodes) {
        if (searching || !collapsed.has(node.id)) {
          for (const child of node.children) list.push({ parent: node.id, child: child.id });
        }
        walk(node.children);
      }
    };
    walk(visible);
    return list;
  }, [visible, collapsed, searching]);

  const { segments, ports, portRadius } = useTreeEdges(rootRef, nodeRefs, links);

  // Поиск без совпадений — не пустой канвас: сообщаем, что веток нет.
  if (searching && visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty className="max-w-sm">
          <EmptyTitle>{ui.employees.searchNoResults}</EmptyTitle>
        </Empty>
      </div>
    );
  }

  function toggle(node: DepartmentNode) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  function renderNode(node: DepartmentNode): React.ReactNode {
    const open = searching || !collapsed.has(node.id);
    const total = totalEmployees(node);
    return (
      <div key={node.id} className="flex flex-col items-center gap-10">
        {/* Карточка — контейнер node-panel; кликабельная область и шеврон —
            СОСЕДНИЕ кнопки (не вложенные: интерактив внутри role=button
            нарушает ARIA, замечание валидации 24.09). */}
        <div
          ref={(el) => {
            if (!el) return;
            nodeRefs.current.set(node.id, el);
            return () => {
              nodeRefs.current.delete(node.id);
            };
          }}
          className={cn(
            'node-panel relative w-60 transition-colors hover:border-input',
            selectedId === node.id && 'border-input bg-accent/40',
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className="block w-full px-3 py-2.5 pr-9 text-left"
          >
            <span className="block truncate text-sm font-medium">{node.name}</span>
            {node.headName ? (
              <span className="mt-1.5 flex items-center gap-1.5">
                <PersonAvatar name={node.headName} avatarUrl={null} className="size-5 shrink-0" />
                <span className="truncate text-xs text-muted-foreground">{node.headName}</span>
              </span>
            ) : (
              <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserRound className="size-5 shrink-0" strokeWidth={1.5} aria-hidden />
                <span className="truncate">{ui.employees.noHead}</span>
              </span>
            )}
            <span className="mt-2 flex items-center gap-3 font-mono text-label-sm text-muted-foreground tabular-nums">
              <span
                className="flex items-center gap-1"
                title={`${ui.employees.employeesCount}: ${total}`}
              >
                <Users className="size-3.5" strokeWidth={1.75} aria-hidden />
                {total}
              </span>
              {node.children.length > 0 && (
                <span
                  className="flex items-center gap-1"
                  title={`${ui.employees.subdepartmentsCount}: ${node.children.length}`}
                >
                  <Folder className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {node.children.length}
                </span>
              )}
            </span>
          </button>
          {node.children.length > 0 && (
            <button
              type="button"
              aria-label={open ? ui.employees.collapseDepartment : ui.employees.expandDepartment}
              onClick={() => toggle(node)}
              className="absolute top-2 right-1.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          )}
        </div>
        {open && node.children.length > 0 && (
          <div className="flex items-start gap-4">{node.children.map(renderNode)}</div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div ref={rootRef} className="relative w-max min-w-full py-6">
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
        </svg>
        <div className="flex justify-center gap-6 px-6">{visible.map(renderNode)}</div>
      </div>
    </div>
  );
}
