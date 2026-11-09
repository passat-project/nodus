import { useMemo } from 'react';
import type { CustomFieldDefinition, TaskListItem, TaskPriority } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';

import { useCustomFieldDefinitions } from '../custom-fields/queries.js';
import { formatDateTime, formatMinutes } from '../lib/format.js';
import { DeadlineChip } from '../ui/deadline-chip.js';
import { identityTone } from '../ui/identity-tone.js';
import { monoCell, PersonCell } from '../ui/person-cell.js';
import { TaskStatusBadge } from '../ui/task-status-badge.js';
import { TaskTypeIcon } from '../ui/task-type-icon.js';
import { attributeColumnFields } from './attribute-fields.js';
import type { DataTableField } from './data-table.js';
import { CommentsCount } from '../tasks/comments-count.js';

export const priorityTone: Record<TaskPriority, 'muted' | 'warning' | 'danger'> = {
  low: 'muted',
  normal: 'muted',
  high: 'warning',
  urgent: 'danger',
};

/**
 * ЕДИНЫЙ реестр колонок плоского списка задач (стандарт владельца, раунд 3:
 * где бы ни показывались задачи — полный набор полей + настройка видимости,
 * модули не отличаются). Потребители: задачи проекта (карточка проекта),
 * задачи сотрудника (карточка сотрудника) — каждый со СВОИМ viewKey (своя
 * память колонок), но реестр один. Дерево-граф журнала задач — отдельный
 * реестр с контекстом ветки (features/tasks/lib/task-fields.tsx).
 *
 * `projectVisible` — колонка «Проект» по умолчанию: внутри карточки
 * проекта контекст очевиден (false), в остальных местах показываем (true).
 *
 * `definitions` — реестр атрибутов модуля «Задачи» (#632): атрибутные
 * колонки идут после системных, скрыты по умолчанию, сортировки не имеют
 * (клиентская сортировка по вычисленным значениям — отдельная ступень).
 */
export function makeTaskTableFields({
  projectVisible = true,
  definitions,
}: {
  projectVisible?: boolean;
  definitions?: readonly CustomFieldDefinition[];
} = {}): DataTableField<TaskListItem>[] {
  return [
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
      render: (task) => (
        <>
          <TaskTypeIcon type={task.type} />
          <span className="truncate text-sm font-medium">{task.title}</span>
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
      defaultVisible: projectVisible,
      defaultWidth: 180,
      minWidth: 120,
      render: (task) =>
        task.project ? (
          <>
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${identityTone[task.project.color].dot}`}
            />
            <span className="truncate text-body-xs text-info/80">{task.project.name}</span>
          </>
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
    // Атрибутные колонки (#632) — после системных, скрыты по умолчанию:
    // общая фабрика видов (значение по грамматике типа, fx/«!», без
    // сортировки — клиентская сортировка по вычисленным значениям отдельно).
    ...attributeColumnFields<TaskListItem>({ definitions, module: 'task' }),
  ];
}

/** Реестр колонок плоского списка задач с атрибутами портала (#632):
 *  определения грузятся один раз на операцию (кэш query), колонки —
 *  мемо-производная. Потребители вызывают хук в компоненте — реестр
 *  меняется вместе с реестром атрибутов. */
export function useTaskTableFields({
  projectVisible = true,
}: { projectVisible?: boolean } = {}): DataTableField<TaskListItem>[] {
  const { data } = useCustomFieldDefinitions('task');
  return useMemo(
    () => makeTaskTableFields({ projectVisible, definitions: data }),
    [projectVisible, data],
  );
}
