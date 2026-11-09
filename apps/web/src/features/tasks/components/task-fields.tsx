import {
  CalendarClock,
  CalendarPlus,
  Eye,
  Flag,
  FolderKanban,
  Hourglass,
  Milestone,
  ChevronDown,
  Shapes,
  Timer,
  User,
  UserPen,
  Users,
} from 'lucide-react';
import { memo, useState } from 'react';
import type { TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { TaskLockBadge } from '../../../shared/forms/field-lock-ui.js';
import { formatDateTime } from '../../../shared/lib/format.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { EntityFields, type EntityFieldDef } from '../../../shared/ui/entity-fields.js';
import { identityTone } from '../../../shared/ui/identity-tone.js';
import type { TaskCardLayoutView } from '../lib/task-card-type-layout.js';
import { TaskDeadlineField, TaskPlannedField, TaskPriorityField } from './task-field-editors.js';
import { TaskChangeTypeDialog } from './task-change-type-dialog.js';
import { TaskAssigneeField, TaskPeopleField } from './task-people-field.js';
import { TaskStageField } from './task-stage-controls.js';
import { TaskSpentField } from './task-time.js';

const VISIBILITY_KEY = 'nodus-task-fields-v1';

/** Инспектор полей карточки задачи: реестр дескрипторов на общем каркасе
 *  EntityFields (shared/ui/entity-fields.tsx — каркас общий с письмом,
 *  проектом и сотрудником; здесь только доменные defs).
 *  Порядок: в 2-колоночной раскладке «Стадия» оказывается строго под
 *  «Проектом», «Наблюдатели» — под «Соисполнителями» (вердикт владельца).
 *  Личная колонка «Моего плана» здесь НЕ показывается — она меняется
 *  только DnD на доске (модель Битрикса). */
export const TaskFields = memo(function TaskFields({
  task,
  layout,
  onOpenSubtask,
}: {
  task: TaskDetail;
  /** Состав карточки по типу (#432): подписи ролей, скрытые блоки, обязательные. */
  layout: TaskCardLayoutView;
  /** Переход к подзадаче из окна причин перехода (#391). */
  onOpenSubtask?: (id: string) => void;
}) {
  const openCard = useOpenCard();
  const lockOf = (key: string) => task.fieldLocks.find((lock) => lock.key === key);
  const lockAddon = (key: string) => {
    const lock = lockOf(key);
    return lock ? <TaskLockBadge lock={lock} /> : undefined;
  };

  const project: EntityFieldDef = {
    key: 'project',
    icon: <FolderKanban className="size-3.5" />,
    label: ui.tasks.project,
    render: () =>
      task.project ? (
        <button
          type="button"
          title={task.project.name}
          className="flex min-w-0 items-center gap-1.5 text-sm text-info hover:underline"
          onClick={() => openCard({ kind: 'project', id: task.project?.id ?? '' })}
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${identityTone[task.project.color].dot}`}
          />
          <span className="truncate">{task.project.name}</span>
        </button>
      ) : (
        ui.common.notSet
      ),
  };
  // Тип задачи (ADR-0020): ступень 1 — один системный «Задача»; смена типа
  // = смена маршрута — придёт со ступенью 2 вместе с редактором схем.
  // Тип меняется ЗДЕСЬ, в поле карточки (решение владельца 19.10: смена типа —
  // осознанная операция с синхронизацией статуса, ей место в поле, не в «⋯»).
  const [changeTypeOpen, setChangeTypeOpen] = useState(false);
  const type: EntityFieldDef = {
    key: 'type',
    icon: <Shapes className="size-3.5" />,
    label: ui.tasks.type,
    render: () =>
      task.access.canEdit ? (
        <>
          <button
            type="button"
            onClick={() => setChangeTypeOpen(true)}
            className="inline-flex min-w-0 items-center gap-1 rounded px-0.5 -mx-0.5 text-left transition-colors hover:bg-accent/50"
            aria-label={`${ui.tasks.changeTypeTitle}: ${task.type.name}`}
          >
            <span className="truncate">{task.type.name}</span>
            <ChevronDown className="size-3 shrink-0 opacity-70" strokeWidth={1.75} />
          </button>
          {changeTypeOpen ? (
            <TaskChangeTypeDialog task={task} onClose={() => setChangeTypeOpen(false)} />
          ) : null}
        </>
      ) : (
        <span>{task.type.name}</span>
      ),
  };
  const created: EntityFieldDef = {
    key: 'created',
    icon: <CalendarPlus className="size-3.5" />,
    label: ui.tasks.created,
    render: () => (
      <span className="font-mono text-label-sm tabular-nums">{formatDateTime(task.createdAt)}</span>
    ),
  };
  // Проекты (#52) ещё без бэкенда: в живом режиме поле скрыто, его слот в
  // сетке занимает «Тип» — «Стадия» по-прежнему под третьим рядом.
  const withProject = projectsAvailable() || task.project !== null;

  const defs: EntityFieldDef[] = [
    {
      key: 'priority',
      icon: <Flag className="size-3.5" />,
      label: ui.tasks.fieldPriority,
      labelAddon: lockAddon('priority'),
      render: () => <TaskPriorityField task={task} lock={lockOf('priority')} />,
    },
    {
      key: 'deadline',
      icon: <CalendarClock className="size-3.5" />,
      label: ui.tasks.deadline,
      labelAddon: lockAddon('deadline'),
      render: () => (
        <TaskDeadlineField
          task={task}
          required={layout.isRequired('deadline')}
          lock={lockOf('deadline')}
        />
      ),
    },
    {
      key: 'assignee',
      icon: <User className="size-3.5" />,
      label: layout.roleLabel('assignee'),
      labelAddon: lockAddon('assignee'),
      render: () => <TaskAssigneeField task={task} lock={lockOf('assignee')} />,
    },
    {
      key: 'creator',
      icon: <UserPen className="size-3.5" />,
      label: layout.roleLabel('creator'),
      render: () => (
        <>
          <PersonAvatar
            name={task.creator.displayName}
            avatarUrl={task.creator.avatarUrl}
            className="size-6"
          />
          <span>{task.creator.displayName}</span>
        </>
      ),
    },
    withProject ? project : type,
    {
      key: 'participants',
      icon: <Users className="size-3.5" />,
      label: layout.roleLabel('coexecutor'),
      labelAddon: lockAddon('coexecutors'),
      render: () => <TaskPeopleField task={task} role="coexecutor" lock={lockOf('coexecutors')} />,
    },
    {
      key: 'stage',
      icon: <Milestone className="size-3.5" />,
      label: ui.tasks.fieldStage,
      render: () => <TaskStageField task={task} onOpenSubtask={onOpenSubtask} />,
    },
    {
      key: 'observers',
      icon: <Eye className="size-3.5" />,
      label: layout.roleLabel('observer'),
      labelAddon: lockAddon('observers'),
      render: () => <TaskPeopleField task={task} role="observer" lock={lockOf('observers')} />,
    },
    // Блок «Время» скрыт типом — нет «Затрачено» и «Плановое время» (#432, Р7).
    ...(layout.blockVisible('time')
      ? [
          {
            key: 'spent',
            icon: <Timer className="size-3.5" />,
            label: ui.tasks.spent,
            render: () => <TaskSpentField task={task} />,
          },
          {
            key: 'planned',
            icon: <Hourglass className="size-3.5" />,
            label: ui.tasks.plannedTime,
            labelAddon: lockAddon('plannedMinutes'),
            render: () => <TaskPlannedField task={task} lock={lockOf('plannedMinutes')} />,
          },
        ]
      : []),
    ...(withProject ? [type, created] : [created]),
  ];

  return <EntityFields defs={defs} storageKey={VISIBILITY_KEY} />;
});
