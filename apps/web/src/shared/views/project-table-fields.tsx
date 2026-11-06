import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import type { CustomFieldDefinition, ProjectListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';

import { useCustomFieldDefinitions } from '../custom-fields/queries.js';
import { formatDate, formatDateTimeShort } from '../lib/format.js';
import { primaryProjectRole } from '../lib/project-role.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { monoCell, PersonCell } from '../ui/person-cell.js';
import { ProjectIdentityIcon } from '../ui/project-identity-icon.js';
import { attributeColumnFields } from './attribute-fields.js';
import type { DataTableField } from './data-table.js';

/** Роль текущего пользователя — чип: руководитель — success, помощник —
 *  info, участник/наблюдатель — muted. Не участвую — прочерк. */
export function ProjectRoleChip({ project }: { project: ProjectListItem }) {
  const role = primaryProjectRole(project.myMembership);
  if (!role) return <span className={monoCell}>—</span>;
  const tone = role === 'manager' ? 'success' : role === 'assistant' ? 'info' : 'muted';
  return (
    <NodeChip tone={tone} className="shrink-0">
      {ui.projects.role[role]}
    </NodeChip>
  );
}

/** Видимость — чип: секретный с замком. */
export function ProjectVisibilityChip({ project }: { project: ProjectListItem }) {
  return (
    <NodeChip tone={project.visibility === 'secret' ? 'warning' : 'muted'} className="shrink-0">
      {project.visibility === 'secret' ? <Lock className="size-3" /> : null}
      {ui.projects.visibility[project.visibility]}
    </NodeChip>
  );
}

/** Статус — чип: действует — success, завершён — info, архив — muted. */
export function ProjectStatusChip({ project }: { project: ProjectListItem }) {
  const tone =
    project.status === 'active' ? 'success' : project.status === 'completed' ? 'info' : 'muted';
  return (
    <NodeChip tone={tone} className="shrink-0">
      {ui.projects.status[project.status]}
    </NodeChip>
  );
}

function MemberPreview({ project }: { project: ProjectListItem }) {
  return (
    <>
      <span className="flex shrink-0 -space-x-1.5">
        {project.membersPreview.slice(0, 4).map((member) => (
          <PersonAvatar
            key={member.id}
            name={member.displayName}
            avatarUrl={member.avatarUrl}
            className="size-6 ring-2 ring-background"
          />
        ))}
      </span>
      <span className={monoCell}>{project.membersCount}</span>
    </>
  );
}

/**
 * Системные колонки списка проектов (стандарт списков): журнал проектов
 * (`projects.list`) и проекты сотрудника/контрагента в их карточках — реестр
 * один, память колонок раздельная. Новое поле модуля = +1 запись здесь
 * (шестерёнка + ручка ресайза).
 */
const projectSystemFields: DataTableField<ProjectListItem>[] = [
  {
    id: 'code',
    label: ui.projects.fieldCode,
    defaultVisible: true,
    defaultWidth: 96,
    minWidth: 64,
    maxWidth: 160,
    render: (project) =>
      project.code ? (
        <span className="font-mono text-label-sm tabular-nums">{project.code}</span>
      ) : (
        <span className={monoCell}>—</span>
      ),
    sortValue: (project) => project.code,
  },
  {
    id: 'name',
    label: ui.projects.fieldName,
    defaultVisible: true,
    defaultWidth: 380,
    minWidth: 160,
    maxWidth: 640,
    locked: true,
    render: (project) => (
      <>
        <ProjectIdentityIcon color={project.color} />
        <span className="truncate text-sm font-medium">{project.name}</span>
      </>
    ),
    sortValue: (project) => project.name,
  },
  {
    id: 'myRole',
    label: ui.projects.filterRole,
    defaultVisible: true,
    defaultWidth: 132,
    minWidth: 104,
    render: (project) => <ProjectRoleChip project={project} />,
    sortValue: (project) => primaryProjectRole(project.myMembership),
  },
  {
    id: 'manager',
    label: ui.projects.manager,
    defaultVisible: true,
    defaultWidth: 180,
    minWidth: 110,
    render: (project) => <PersonCell user={project.manager} />,
    sortValue: (project) => project.manager?.displayName ?? null,
  },
  {
    id: 'assistants',
    label: ui.projects.assistants,
    defaultVisible: false,
    defaultWidth: 132,
    minWidth: 96,
    render: (project) =>
      project.assistants.length === 0 ? (
        <span className={monoCell}>—</span>
      ) : (
        <span className="flex shrink-0 -space-x-1.5">
          {project.assistants.slice(0, 4).map((assistant) => (
            <PersonAvatar
              key={assistant.id}
              name={assistant.displayName}
              avatarUrl={assistant.avatarUrl}
              className="size-6 ring-2 ring-background"
            />
          ))}
        </span>
      ),
    sortValue: (project) => project.assistants.length,
  },
  {
    id: 'portfolio',
    label: ui.projects.filterPortfolio,
    defaultVisible: true,
    defaultWidth: 168,
    minWidth: 120,
    render: (project) =>
      project.portfolio ? (
        <span className="truncate text-sm">{project.portfolio.name}</span>
      ) : (
        <span className={monoCell}>—</span>
      ),
    sortValue: (project) => project.portfolio?.name ?? null,
  },
  {
    id: 'type',
    label: ui.projects.fieldType,
    defaultVisible: false,
    defaultWidth: 120,
    minWidth: 96,
    render: (project) =>
      project.type ? (
        <span className="truncate text-sm">{project.type.name}</span>
      ) : (
        <span className={monoCell}>—</span>
      ),
    sortValue: (project) => project.type?.name ?? null,
  },
  {
    id: 'visibility',
    label: ui.projects.fieldVisibility,
    defaultVisible: true,
    defaultWidth: 124,
    minWidth: 104,
    render: (project) => <ProjectVisibilityChip project={project} />,
    sortValue: (project) => project.visibility,
  },
  {
    id: 'status',
    label: ui.projects.fieldStatus,
    defaultVisible: true,
    defaultWidth: 128,
    minWidth: 104,
    render: (project) => <ProjectStatusChip project={project} />,
    sortValue: (project) => project.status,
  },
  {
    id: 'members',
    label: ui.projects.members,
    defaultVisible: true,
    defaultWidth: 168,
    minWidth: 120,
    render: (project) => <MemberPreview project={project} />,
    sortValue: (project) => project.membersCount,
  },
  {
    id: 'client',
    label: ui.projects.fieldClient,
    defaultVisible: false,
    defaultWidth: 200,
    minWidth: 140,
    render: (project) =>
      project.client ? (
        <span className="truncate text-sm">{project.client.name}</span>
      ) : (
        <span className={monoCell}>—</span>
      ),
    sortValue: (project) => project.client?.name ?? null,
  },
  {
    id: 'endDate',
    label: ui.projects.endDate,
    defaultVisible: false,
    defaultWidth: 132,
    minWidth: 108,
    render: (project) =>
      project.endDate ? (
        <span className={monoCell}>{formatDate(project.endDate)}</span>
      ) : (
        <span className={monoCell}>—</span>
      ),
    sortValue: (project) => project.endDate,
  },
  {
    id: 'activityAt',
    label: ui.projects.activity,
    defaultVisible: true,
    defaultWidth: 152,
    minWidth: 128,
    render: (project) => (
      <span className={monoCell}>{formatDateTimeShort(project.activityAt)}</span>
    ),
    sortValue: (project) => project.activityAt,
  },
];

/**
 * ЕДИНЫЙ реестр колонок списка проектов (#632): системные поля модуля плюс
 * атрибуты портала. `definitions` — реестр атрибутов модуля «Проекты»:
 * атрибуты, привязанные к типам проектов, идут колонками после системных,
 * скрыты по умолчанию (включаются шестерёнкой в группе «Атрибуты»),
 * сортировки не имеют (серверная — #435). Значения — из строки списка
 * (`customFields`/`customFieldRefs`/`customFieldFormulas`), пустое значение —
 * пустая ячейка.
 */
export function makeProjectTableFields({
  definitions,
}: { definitions?: readonly CustomFieldDefinition[] } = {}): DataTableField<ProjectListItem>[] {
  return [
    ...projectSystemFields,
    // Атрибутные колонки (#632, Р9) — после системных, скрыты по умолчанию
    // (общая фабрика с задачами и письмами: одна семантика ячейки).
    ...attributeColumnFields<ProjectListItem>({ definitions, module: 'project' }),
  ];
}

/** Реестр колонок списка проектов с атрибутами портала (#632, Р9):
 *  определения грузятся один раз на операцию (кэш query), колонки —
 *  мемо-производная. Потребители вызывают хук в компоненте. */
export function useProjectTableFields(): DataTableField<ProjectListItem>[] {
  const { data } = useCustomFieldDefinitions('project');
  return useMemo(() => makeProjectTableFields({ definitions: data }), [data]);
}
