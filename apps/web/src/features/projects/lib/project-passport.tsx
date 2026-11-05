import {
  Activity,
  CalendarClock,
  CalendarPlus,
  Eye,
  FolderOpen,
  Lock,
  Tag,
  User,
  UserCog,
  UserPen,
  Users,
} from 'lucide-react';
import type { ProjectDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import type { CardRef } from '../../../app/shell/card-stack.js';
import { formatDate, formatDateTime } from '../../../shared/lib/format.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import type { EntityFieldDef } from '../../../shared/ui/entity-fields.js';
import {
  ProjectStatusChip,
  ProjectVisibilityChip,
} from '../../../shared/views/project-table-fields.js';

const monoValue = 'font-mono text-label-sm tabular-nums';

function personLink(
  user: { id: string; displayName: string; avatarUrl: string | null },
  openCard: (ref: CardRef) => void,
) {
  return (
    <button
      type="button"
      onClick={() => openCard({ kind: 'employee', id: user.id })}
      className="flex min-w-0 items-center gap-2 hover:underline"
    >
      <PersonAvatar
        name={user.displayName}
        avatarUrl={user.avatarUrl}
        className="size-6 shrink-0"
      />
      <span className="truncate">{user.displayName}</span>
    </button>
  );
}

/**
 * Паспорт проекта — ВСЯ информация полями-реестром (вердикт владельца
 * 07.11.2026: шапки-витрины в панели «О проекте» нет, название живёт в хроме
 * карточки и правится кликом). Поля: статус, видимость, тип, портфель,
 * руководство, крайний срок, состав, создатель, активность. Шифр и заказчик
 * — атрибуты: живут в блоке «Атрибуты» панели (#631), не в паспорте.
 * «Начала» проекта нет — есть крайний срок (тот же вердикт). Ссылки на
 * сотрудников открываются карточками стека (ADR-0009).
 */
export function projectPassportDefs(
  project: ProjectDetail,
  openCard: (ref: CardRef) => void,
): EntityFieldDef[] {
  return [
    {
      key: 'status',
      icon: <Activity className="size-3.5" />,
      label: ui.projects.fieldStatus,
      render: () => <ProjectStatusChip project={project} />,
    },
    {
      key: 'visibility',
      icon: <Lock className="size-3.5" />,
      label: ui.projects.fieldVisibility,
      render: () => <ProjectVisibilityChip project={project} />,
    },
    {
      key: 'type',
      icon: <Tag className="size-3.5" />,
      label: ui.projects.fieldType,
      render: () => <span className="truncate">{project.type?.name ?? ui.common.notSet}</span>,
    },
    {
      key: 'portfolio',
      icon: <FolderOpen className="size-3.5" />,
      label: ui.projects.filterPortfolio,
      render: () => <span className="truncate">{project.portfolio?.name ?? ui.common.notSet}</span>,
    },
    {
      key: 'manager',
      icon: <User className="size-3.5" />,
      label: ui.projects.manager,
      render: () => (project.manager ? personLink(project.manager, openCard) : ui.common.notSet),
    },
    {
      key: 'assistants',
      icon: <UserCog className="size-3.5" />,
      label: ui.projects.assistants,
      render: () =>
        project.assistants.length === 0 ? (
          ui.common.notSet
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {project.assistants.map((assistant) => (
              <span key={assistant.id}>{personLink(assistant, openCard)}</span>
            ))}
          </span>
        ),
    },
    {
      key: 'endDate',
      icon: <CalendarClock className="size-3.5" />,
      label: ui.projects.deadline,
      render: () =>
        project.endDate ? (
          <span className={monoValue}>{formatDate(project.endDate)}</span>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'members',
      icon: <Users className="size-3.5" />,
      label: ui.projects.members,
      render: () => (
        <>
          <span className="flex shrink-0 -space-x-1.5">
            {project.membersPreview.slice(0, 4).map((member) => (
              <PersonAvatar
                key={member.id}
                name={member.displayName}
                avatarUrl={member.avatarUrl}
                className="size-6 ring-2 ring-card"
              />
            ))}
          </span>
          <span className="font-mono text-label-sm tabular-nums">{project.membersCount}</span>
        </>
      ),
    },
    {
      key: 'observers',
      icon: <Eye className="size-3.5" />,
      label: ui.projects.observers,
      render: () =>
        project.observers.length === 0 ? (
          ui.common.notSet
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {project.observers.map((observer) => (
              <span key={observer.id}>{personLink(observer, openCard)}</span>
            ))}
          </span>
        ),
    },
    {
      key: 'creator',
      icon: <UserPen className="size-3.5" />,
      label: ui.projects.creator,
      render: () => personLink(project.creator, openCard),
    },
    {
      key: 'createdAt',
      icon: <CalendarPlus className="size-3.5" />,
      label: ui.projects.created,
      render: () => <span className={monoValue}>{formatDateTime(project.createdAt)}</span>,
    },
    {
      key: 'activity',
      icon: <Activity className="size-3.5" />,
      label: ui.projects.activity,
      render: () => <span className={monoValue}>{formatDateTime(project.activityAt)}</span>,
    },
  ];
}
