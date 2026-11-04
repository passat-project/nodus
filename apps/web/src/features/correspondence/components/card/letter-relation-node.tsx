import { ArrowLeftRight, Layers, Link2Off, Lock, Reply } from 'lucide-react';
import type { LetterTreeNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { orthPath, snapPx } from '@nodus/ui/components/node-edge';
import { cn } from '@nodus/ui/lib/utils';

import { RowMenu, type RowMenuItem } from '../../../../shared/views/row-menu.js';
import { uiPx } from '../../../../shared/ui/ui-scale.js';
import type { LetterTreeRow } from '../../lib/letter-tree.js';

/** Геометрия графа «ёлочки» — грамматика дерева-графа журнала задач
 *  (`task-list-graph`): порт уровня d на x = 12 + d·16, локти r=6, у ветки
 *  порт — кнопка раскрытия r=7, у листа — точка r=3. Строка — две линии
 *  (тема + номер/вид связи): темы писем длинные, в 300px одна строка
 *  обрезала и тему, и номер. */
export const TREE_ROW_H = uiPx(48);
const graphX = (depth: number) => uiPx(12 + depth * 16);
/** Подложка узла начинается правее его порта: порт → «плашка» узла. */
const nodeLeft = (depth: number) => graphX(depth) + uiPx(10);
const MID = TREE_ROW_H / 2;
const ELBOW = 6;
const BRANCH_GAP = 8;
const LEAF_GAP = 3;

/** Номер письма в узле: регистрационный, иначе номер корреспондента. */
export const nodeNumber = (node: LetterTreeNode): string =>
  node.regNumber ?? node.theirNumber ?? ui.letters.noNumber;

/**
 * Рёбра «ёлочки» — единый SVG поверх строк (одна система координат,
 * hairline-snap): ствол ветки — один путь от порта родителя до последнего
 * ребёнка со скруглённым локтем, отводы остальных детей — горизонтали от
 * ствола (Т-стык), каждое ребро рисуется ровно один раз. Порт текущего
 * письма — активный узел: заливка `--port` и свечение (канон: glow — только
 * активному узлу).
 */
export function LetterTreeEdges({
  rows,
  currentId,
}: {
  rows: readonly LetterTreeRow[];
  currentId: string;
}) {
  const paths: string[] = [];
  const midY = (index: number) => index * TREE_ROW_H + MID;
  rows.forEach((row, index) => {
    const children: number[] = [];
    for (let j = index + 1; j < rows.length; j += 1) {
      const below = rows[j];
      if (!below || below.depth <= row.depth) break;
      if (below.depth === row.depth + 1) children.push(j);
    }
    if (children.length === 0) return;
    const px = snapPx(graphX(row.depth));
    const stopOf = (childIndex: number) => {
      const child = rows[childIndex];
      return child?.hasChildren ? BRANCH_GAP : LEAF_GAP;
    };
    const lastIndex = children[children.length - 1] ?? index;
    const lastY = snapPx(midY(lastIndex));
    const childX = (childIndex: number) => snapPx(graphX(row.depth + 1) - stopOf(childIndex));
    paths.push(
      orthPath(
        [
          { x: px, y: snapPx(midY(index) + BRANCH_GAP) },
          { x: px, y: lastY },
          { x: childX(lastIndex), y: lastY },
        ],
        ELBOW,
      ),
    );
    for (const childIndex of children.slice(0, -1)) {
      const y = snapPx(midY(childIndex));
      paths.push(`M${px},${y} L${childX(childIndex)},${y}`);
    }
  });
  const height = rows.length * TREE_ROW_H;
  const width = graphX(Math.max(0, ...rows.map((row) => row.depth))) + uiPx(12);
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute top-0 left-0 text-edge"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1} />
      ))}
      {rows.map((row, index) =>
        row.hasChildren ? null : (
          <circle
            key={row.key}
            cx={snapPx(graphX(row.depth))}
            cy={snapPx(midY(index))}
            r={row.node.id === currentId ? 3.5 : 3}
            className={row.node.id === currentId ? 'fill-port' : 'fill-port/50'}
            style={row.node.id === currentId ? { filter: 'drop-shadow(var(--glow))' } : undefined}
          />
        ),
      )}
    </svg>
  );
}

/**
 * Узел «ёлочки» (#461, Р2/В5): порт-переключатель ветки (у письма с
 * ответами или вложенными), «плашка» письма в две строки — тема (замок у
 * конфиденциального) и номер с видом связи к родителю («ответ» /
 * «вложено»); клик — переход в карточке заменой. Меню узла (канцелярия) —
 * «Заменить связь» / «Снять связь» с родителем.
 */
export function LetterRelationNode({
  row,
  currentId,
  collapsed,
  canManage,
  onToggle,
  onNavigate,
  onReplace,
  onUnlink,
}: {
  row: LetterTreeRow;
  currentId: string;
  collapsed: boolean;
  canManage: boolean;
  onToggle: (key: string) => void;
  onNavigate: (id: string) => void;
  onReplace: (node: LetterTreeNode) => void;
  onUnlink: (node: LetterTreeNode) => void;
}) {
  const { node, depth } = row;
  const isCurrent = node.id === currentId;
  const subject = node.subject ?? ui.letters.noSubject;
  const kind =
    node.relationKind === 'nested_in'
      ? { icon: Layers, label: ui.letters.relations.nodeNestedIn }
      : node.relationKind === 'reply_to'
        ? { icon: Reply, label: ui.letters.relations.nodeReplyTo }
        : null;
  const menu: RowMenuItem[] =
    canManage && node.relationId
      ? [
          {
            id: 'replace',
            icon: <ArrowLeftRight className="size-3.5" strokeWidth={1.75} />,
            label: ui.letters.relations.menuReplace,
            onSelect: () => onReplace(node),
          },
          {
            id: 'unlink',
            icon: <Link2Off className="size-3.5" strokeWidth={1.75} />,
            label: ui.letters.relations.menuUnlink,
            danger: true,
            onSelect: () => onUnlink(node),
          },
        ]
      : [];

  return (
    <div className="relative" style={{ height: TREE_ROW_H }}>
      {row.hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(row.key)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? ui.tasks.expandBranch : ui.tasks.collapseBranch}
          className={cn(
            'absolute top-1/2 z-10 -translate-y-1/2 cursor-pointer transition-colors duration-200 hover:text-port',
            isCurrent ? 'text-port' : 'text-port/70',
          )}
          style={{
            left: graphX(depth) - 9,
            filter: isCurrent ? 'drop-shadow(var(--glow))' : undefined,
          }}
        >
          <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
            <circle cx={9} cy={9} r={7} fill="var(--card)" stroke="currentColor" strokeWidth={1} />
            <path
              d={collapsed ? 'M6,9 L12,9 M9,6 L9,12' : 'M6,9 L12,9'}
              stroke="currentColor"
              strokeWidth={1.25}
            />
          </svg>
        </button>
      ) : null}
      <div
        className={cn(
          'group/node absolute inset-y-1 right-0 flex min-w-0 items-center rounded-lg transition-colors',
          isCurrent ? 'bg-accent' : 'hover:bg-accent/50',
        )}
        style={{ left: nodeLeft(depth) }}
      >
        <button
          type="button"
          onClick={() => {
            if (!isCurrent) onNavigate(node.id);
          }}
          aria-current={isCurrent ? 'true' : undefined}
          title={subject}
          className="flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5 rounded-lg pr-1 pl-2 text-left focus-visible:outline-2 focus-visible:outline-ring aria-[current]:cursor-default"
        >
          <span
            className={cn(
              'flex w-full min-w-0 items-center gap-1 text-sm leading-tight',
              isCurrent ? 'font-medium text-foreground' : 'text-secondary-foreground',
              !node.subject && 'text-muted-foreground',
            )}
          >
            {node.confidential ? (
              <Lock
                aria-label={ui.letters.confidential.badge}
                className="size-3 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
            ) : null}
            <span className="min-w-0 truncate">{subject}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-label-sm leading-none text-muted-foreground">
            <span className="shrink-0 font-mono tabular-nums">{nodeNumber(node)}</span>
            {kind ? (
              <span className="flex min-w-0 items-center gap-1 truncate">
                <kind.icon aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
                {kind.label}
              </span>
            ) : null}
            {collapsed && row.descendants > 0 ? (
              <span className="ml-auto shrink-0 font-mono tabular-nums">+{row.descendants}</span>
            ) : null}
          </span>
        </button>
        {menu.length > 0 ? (
          <span className="mr-1 shrink-0 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
            <RowMenu items={menu} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
