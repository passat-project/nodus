import { ChevronRight } from 'lucide-react';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  NodeKind,
  TaskListItem,
} from '@nodus/contracts';
import { isCustomFieldValueFilled, ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { cn } from '@nodus/ui/lib/utils';

import { formatDate, formatMinutes } from '../../../../shared/lib/format.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { monoCell, PersonCell } from '../../../../shared/ui/person-cell.js';
import { TaskStatusBadge } from '../../../../shared/ui/task-status-badge.js';
import {
  attributeFitsModule,
  attributeFormula,
  attributeRenderCell,
  attributeValue,
  isAttributeFieldId,
} from '../../../../shared/views/attribute-fields.js';
import { RowMenu, type RowMenuItem } from '../../../../shared/views/row-menu.js';
import type { FieldDef, ViewField } from '../../../../shared/views/use-view-fields.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { NodeKindGlyph } from '../lib/node-kind-icon.js';
import type { StructureNodeRow } from '../lib/structure-tree.js';

/** Общие ячейки строк структуры: значок/номер, прогресс, часы, срок,
 *  ведущая ячейка и кнопка ветки. Вынесены из строк (I5) и переиспользуются
 *  узлом и задачей — одна грамматика значений.
 *
 *  Атрибутные ячейки (#632): поле `cf.<id>` рисует значение из
 *  `customFields` строки (папка или задача — свой носитель) по грамматике
 *  типа определения; определения и ссылки приходят картами от модели вида. */

export type StructureField = ViewField<FieldDef>;

/** Карта определений атрибутных колонок по id поля (`cf.<id>`). */
export type StructureAttributeDefs = ReadonlyMap<string, CustomFieldDefinition>;

export const rowBase =
  'group/row relative grid h-12 w-max min-w-full items-stretch gap-3 border-b border-border/60 px-4 select-none transition-colors [contain-intrinsic-size:auto_3rem] [content-visibility:auto] focus-visible:outline-2 focus-visible:outline-ring';

export function InsertLine({ zone }: { zone: 'before' | 'after' | null }) {
  if (!zone) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-1 z-10 h-0.5 bg-primary',
        zone === 'before' ? 'top-0' : 'bottom-0',
      )}
    >
      <span className="absolute -top-0.5 left-0 size-1.5 rounded-full bg-primary" />
    </span>
  );
}

export function ProgressCell({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  const percent = Math.round((done / total) * 100);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-accent"
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </span>
      <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}

export function TimeCell({ minutes }: { minutes: number | null | undefined }) {
  // 0 и отсутствие значения — пустая ячейка; NaN из старого ответа API тоже
  // не должен превращаться в «NaN:NaN ч».
  if (!minutes) return null;
  return (
    <span className="flex min-w-0 items-baseline gap-1 font-mono text-label-sm tabular-nums">
      <span className="text-foreground">{formatMinutes(minutes)}</span>
      <span className="text-label-sm text-muted-foreground">{ui.structure.hoursShort}</span>
    </span>
  );
}

export function nodeCell(
  row: StructureNodeRow,
  fieldId: string,
  kind: NodeKind | undefined,
  attributes: StructureAttributeDefs,
  refs: ReadonlyMap<string, CustomFieldRef>,
) {
  // Атрибут вида папки (#632): значение папки. Определения нет или атрибут
  // не про папки (колонка сквозная для задач и папок) — пустая ячейка, как
  // любая неприменимая в этой строке.
  if (isAttributeFieldId(fieldId)) {
    const definition = attributes.get(fieldId);
    if (!definition || !attributeFitsModule(definition, 'node')) return null;
    const value = attributeValue(row.node, definition);
    const formula = attributeFormula(row.node, definition);
    // Ошибка формулы видна и без значения (бейдж «!»), иначе колонка
    // молчала бы о сломанной формуле.
    if (!isCustomFieldValueFilled(value) && !formula?.error) return null;
    return attributeRenderCell(definition, value, refs, { formula });
  }
  switch (fieldId) {
    case 'name':
      return (
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded border',
              kind
                ? identityTone[kind.color].tile
                : 'border-border bg-accent/40 text-muted-foreground',
            )}
            title={kind?.name}
          >
            <NodeKindGlyph icon={kind?.icon ?? 'folder'} className="size-3.5" />
          </span>
          <span className="truncate text-sm font-semibold" title={row.node.name}>
            {row.node.name}
          </span>
        </span>
      );
    case 'code':
      return row.node.code ? <span className={monoCell}>{row.node.code}</span> : null;
    case 'progress':
      return <ProgressCell done={row.subtree.doneCount} total={row.subtree.taskCount} />;
    case 'plan':
      return <TimeCell minutes={row.subtree.taskCount > 0 ? row.subtree.plannedMinutes : null} />;
    case 'fact':
      return <TimeCell minutes={row.subtree.spentMinutes} />;
    case 'deadline':
      return row.subtree.nearestDeadline ? (
        <span className={monoCell}>{formatDate(row.subtree.nearestDeadline)}</span>
      ) : null;
    case 'latest':
      return row.subtree.latestDeadline ? (
        <span className={monoCell}>{formatDate(row.subtree.latestDeadline)}</span>
      ) : null;
    default:
      return null;
  }
}

export function taskCell(
  task: TaskListItem,
  fieldId: string,
  attributes: StructureAttributeDefs,
  refs: ReadonlyMap<string, CustomFieldRef>,
) {
  // Атрибут задачи (#632): значение задачи-листа; ссылки — её собственные
  // (срез списка задач, не структуры). Атрибут папок в строке задачи —
  // пустая ячейка.
  if (isAttributeFieldId(fieldId)) {
    const definition = attributes.get(fieldId);
    if (!definition || !attributeFitsModule(definition, 'task')) return null;
    const value = attributeValue(task, definition);
    const formula = attributeFormula(task, definition);
    if (!isCustomFieldValueFilled(value) && !formula?.error) return null;
    return attributeRenderCell(definition, value, refs, { formula });
  }
  switch (fieldId) {
    case 'name':
      return (
        <span className="flex min-w-0 items-center gap-2">
          <ProcessTypeGlyph
            icon={task.type.icon ?? 'file-text'}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="truncate text-sm" title={task.title}>
            {task.title}
          </span>
        </span>
      );
    case 'progress':
      return <ProgressCell done={task.checklistDone} total={task.checklistTotal} />;
    case 'plan':
      return <TimeCell minutes={task.plannedMinutes} />;
    case 'fact':
      return <TimeCell minutes={task.spentMinutes} />;
    case 'deadline':
      return task.deadline ? <span className={monoCell}>{formatDate(task.deadline)}</span> : null;
    case 'assignee':
      return <PersonCell user={task.assignee} />;
    case 'stage':
      return <TaskStatusBadge stage={task.stage} />;
    default:
      return null;
  }
}

export function LeadingCell({
  selected,
  onToggleSelected,
  items,
  showSelection,
}: {
  selected: boolean;
  onToggleSelected: () => void;
  items: RowMenuItem[];
  showSelection: boolean;
}) {
  return (
    <span
      role="cell"
      className="flex items-center gap-1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {showSelection ? (
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label={ui.common.selectRow}
        />
      ) : null}
      <RowMenu items={items} />
    </span>
  );
}

/** Шеврон раскрытия — обычная кнопка в строке названия (проводник), без
 *  отдельной колонки графа, линий и точек. */
export function BranchButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-expanded={!collapsed}
      aria-label={collapsed ? ui.tasks.expandBranch : ui.tasks.collapseBranch}
      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ChevronRight
        className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
        strokeWidth={1.75}
      />
    </button>
  );
}
