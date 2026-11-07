import { useMemo, type ReactNode } from 'react';
import { Mail, MessageSquare } from 'lucide-react';
import type { TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';

import { formatDateTime, formatMinutes } from '../../../shared/lib/format.js';
import { DeadlineChip } from '../../../shared/ui/deadline-chip.js';
import { monoCell, PersonCell } from '../../../shared/ui/person-cell.js';
import { priorityTone } from '../../../shared/views/task-table-fields.js';
import { attributeColumnFields } from '../../../shared/views/attribute-fields.js';
import type { FieldDef } from '../../../shared/views/use-view-fields.js';
import { TaskStatusBadge } from '../../../shared/ui/task-status-badge.js';
import { CommentsCount } from '../../../shared/tasks/comments-count.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';

/** Контекст ячейки списка: состояние ветки дерева (счётчик свёрнутых). */
export interface CellContext {
  branchCollapsed?: boolean;
  childCount?: number;
}

export interface ListFieldDef extends FieldDef {
  render: (task: TaskListItem, ctx: CellContext) => ReactNode;
  /** Значение для сортировки (концепт #4): задано → заголовок кликабелен (↑/↓). */
  sortValue?: (task: TaskListItem) => string | number | null;
}

function SourceIcon({ task }: { task: TaskListItem }) {
  if (task.source === 'letter')
    return <Mail className="size-3.5 shrink-0 text-info/70" aria-label={ui.tasks.fromLetter} />;
  if (task.source === 'chat_message')
    return (
      <MessageSquare className="size-3.5 shrink-0 text-info/70" aria-label={ui.tasks.fromChat} />
    );
  return null;
}

/**
 * Реестр колонок списка задач (кастомизация представлений): видимость и
 * ширина настраиваются пользователем через шестерёнку и ручку хедера;
 * новое поле модуля = +1 запись здесь.
 */
export const taskListFields: ListFieldDef[] = [
  {
    id: 'number',
    label: ui.tasks.fieldNumber,
    defaultVisible: true,
    defaultWidth: 56,
    minWidth: 48,
    maxWidth: 96,
    render: (task) => <span className={monoCell}>{task.number}</span>,
    sortValue: (task) => task.number,
  },
  {
    id: 'title',
    label: ui.tasks.fieldTitle,
    defaultVisible: true,
    defaultWidth: 340,
    minWidth: 160,
    maxWidth: 640,
    locked: true,
    render: (task, ctx) => (
      <>
        <SourceIcon task={task} />
        <span className="truncate text-sm font-medium">{task.title}</span>
        {ctx.branchCollapsed && (ctx.childCount ?? 0) > 0 ? (
          <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
            +{ctx.childCount}
          </span>
        ) : null}
      </>
    ),
    sortValue: (task) => task.title,
  },
  {
    id: 'stage',
    label: ui.tasks.fieldStage,
    defaultVisible: true,
    defaultWidth: 128,
    minWidth: 116,
    render: (task) => <TaskStatusBadge stage={task.stage} />,
    // order стадии — сортировка по ходу workflow, а не по алфавиту.
    sortValue: (task) => task.stage.order,
  },
  {
    id: 'deadline',
    label: ui.tasks.deadline,
    defaultVisible: true,
    defaultWidth: 172,
    minWidth: 140,
    render: (task) => <DeadlineChip deadline={task.deadline} state={task.stage.systemState} />,
    sortValue: (task) => task.deadline,
  },
  {
    id: 'assignee',
    label: ui.tasks.assignee,
    defaultVisible: true,
    defaultWidth: 160,
    minWidth: 110,
    render: (task) => <PersonCell user={task.assignee} />,
    sortValue: (task) => task.assignee?.displayName ?? null,
  },
  {
    id: 'creator',
    label: ui.tasks.creator,
    defaultVisible: false,
    defaultWidth: 160,
    minWidth: 110,
    render: (task) => <PersonCell user={task.creator} />,
    sortValue: (task) => task.creator?.displayName ?? null,
  },
  {
    id: 'project',
    label: ui.tasks.project,
    defaultVisible: false,
    defaultWidth: 180,
    minWidth: 120,
    render: (task) =>
      task.project ? (
        <span className="truncate text-body-xs text-info/80">{task.project.name}</span>
      ) : (
        <span className={monoCell}>—</span>
      ),
    sortValue: (task) => task.project?.name ?? null,
  },
  {
    id: 'priority',
    label: ui.tasks.fieldPriority,
    defaultVisible: false,
    defaultWidth: 108,
    minWidth: 92,
    render: (task) => (
      <NodeChip tone={priorityTone[task.priority]}>{ui.tasks.priority[task.priority]}</NodeChip>
    ),
    // Числом — порядок важности, а не алфавит кода.
    sortValue: (task) => ({ low: 0, normal: 1, high: 2, urgent: 3 })[task.priority],
  },
  {
    id: 'comments',
    label: ui.tasks.colComments,
    defaultVisible: true,
    defaultWidth: 60,
    minWidth: 48,
    render: (task) => <CommentsCount task={task} className={monoCell} />,
    sortValue: (task) => task.commentsCount,
  },
  {
    id: 'spent',
    label: ui.tasks.colSpent,
    defaultVisible: true,
    defaultWidth: 72,
    minWidth: 56,
    render: (task) => (
      <span className={monoCell}>
        {task.spentMinutes > 0 ? formatMinutes(task.spentMinutes) : null}
      </span>
    ),
    sortValue: (task) => task.spentMinutes,
  },
  {
    id: 'updated',
    label: ui.tasks.fieldUpdated,
    defaultVisible: false,
    defaultWidth: 140,
    minWidth: 112,
    render: (task) => <span className={monoCell}>{formatDateTime(task.updatedAt)}</span>,
    sortValue: (task) => task.updatedAt,
  },
];

/**
 * Реестр колонок дерева-журнала + атрибуты места «задача» (#632, В3/В5):
 * атрибутные колонки скрыты по умолчанию, включаются шестерёнкой; сортировка
 * по ним не включается (серверная сортировка — #435).
 */
export function useTaskListFields(): ListFieldDef[] {
  const definitions = useCustomFieldDefinitions('task');
  return useMemo(
    () => [
      ...taskListFields,
      ...attributeColumnFields<TaskListItem>({ definitions: definitions.data, module: 'task' }),
    ],
    [definitions.data],
  );
}
