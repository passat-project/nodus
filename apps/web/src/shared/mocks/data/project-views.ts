import type {
  CustomFieldValues,
  ProjectAccess,
  ProjectDetail,
  ProjectHistoryEntry,
  ProjectListItem,
  ProjectMember,
  ProjectMyMembership,
  ProjectParticipantSource,
  ProjectRef,
  UserRef,
} from '@nodus/contracts';
import { Permission, SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { counterpartyRefById } from './counterparties.js';
import { demoRefsForValues } from './custom-fields-refs.js';
import {
  demoParticipantRowsOf,
  demoProjectGroups,
  demoProjectRows,
  demoProjectTypes,
  findDemoProjectRow,
  type DemoProjectRow,
} from './projects.js';
import type { DemoProjectEvent } from './project-events.js';
import { structureSummaryOf } from './project-nodes.js';
import { currentAuthUser, userRef } from './users.js';

export interface DemoActor {
  id: string;
  permissions: readonly string[];
}

const SOURCE_ORDER: ProjectParticipantSource[] = [
  'manager',
  'assistant',
  'member',
  'task',
  'observer',
];

function safeUserRef(id: string): UserRef {
  try {
    return userRef(id);
  } catch {
    return { id, displayName: '', avatarUrl: null };
  }
}

export function projectRefOf(row: DemoProjectRow): ProjectRef {
  return { id: row.id, code: row.code, name: row.name, color: row.color };
}

export function myMembershipOf(projectId: string, userId: string): ProjectMyMembership {
  const rows = demoParticipantRowsOf(projectId).filter((entry) => entry.userId === userId);
  return {
    manager: rows.some((entry) => entry.source === 'manager'),
    assistant: rows.some((entry) => entry.source === 'assistant'),
    participant: rows.some((entry) => entry.source === 'task' || entry.source === 'member'),
    observer: rows.some((entry) => entry.source === 'observer'),
  };
}

export function accessOf(
  row: DemoProjectRow,
  membership: ProjectMyMembership,
  permissions: readonly string[],
): ProjectAccess {
  const manager = membership.manager;
  const canManage =
    manager || membership.assistant || permissions.includes(Permission.PROJECT_MANAGE);
  return {
    canManage,
    canManageMembers: canManage,
    canJoin:
      row.visibility === 'open' &&
      row.status !== 'archived' &&
      !membership.manager &&
      !membership.assistant &&
      !membership.participant &&
      !membership.observer,
    canLeave: membership.observer && !membership.manager && !membership.assistant,
    canPostToChannel:
      manager || membership.assistant || permissions.includes(Permission.PROJECT_CHANNEL_POST),
    canTransfer: manager,
  };
}

function participantIdsOf(projectId: string): string[] {
  const seen = new Set<string>();
  for (const entry of demoParticipantRowsOf(projectId)) {
    // Наблюдатели — отдельное поле карточки, в «Участников» не входят.
    if (entry.source === 'observer') continue;
    seen.add(entry.userId);
  }
  return [...seen];
}

export function listItemOf(row: DemoProjectRow, actor: DemoActor): ProjectListItem {
  const membership = myMembershipOf(row.id, actor.id);
  const members = participantIdsOf(row.id);
  const type = demoProjectTypes.find((entry) => entry.id === row.typeId);
  const portfolio = demoProjectGroups.find((entry) => entry.id === row.portfolioId);
  // Шифр/заказчик — производные системных атрибутов (как серверный DTO).
  const values = projectCustomFieldsOf(row);
  const code = values[SYSTEM_FIELD_IDS.projectCode];
  const clientId = values[SYSTEM_FIELD_IDS.projectClient];
  return {
    id: row.id,
    code: typeof code === 'string' && code !== '' ? code : null,
    name: row.name,
    color: row.color,
    manager: row.managerId ? safeUserRef(row.managerId) : null,
    assistants: row.assistantIds.map(safeUserRef),
    myMembership: membership,
    visibility: row.visibility,
    status: row.status,
    type: type ? { id: type.id, name: type.name } : null,
    portfolio: portfolio ? { id: portfolio.id, name: portfolio.name } : null,
    client:
      typeof clientId === 'string' && clientId !== ''
        ? (counterpartyRefById(clientId) ?? null)
        : null,
    membersCount: members.length,
    membersPreview: members.slice(0, 5).map(safeUserRef),
    endDate: row.endDate,
    activityAt: row.updatedAt,
  };
}

/** Значения атрибутов проекта мок-мира: системные «Шифр»/«Заказчик»
 *  переехали в customFields (Р9 #631), row.code/clientId — производные. */
export function projectCustomFieldsOf(row: DemoProjectRow): CustomFieldValues {
  const values: CustomFieldValues = { ...row.customFields };
  if (row.code) values[SYSTEM_FIELD_IDS.projectCode] ??= row.code;
  if (row.clientId) values[SYSTEM_FIELD_IDS.projectClient] ??= row.clientId;
  return values;
}

export function detailOf(row: DemoProjectRow, actor: DemoActor): ProjectDetail {
  const membership = myMembershipOf(row.id, actor.id);
  const observers = [
    ...new Set(
      demoParticipantRowsOf(row.id)
        .filter((entry) => entry.source === 'observer')
        .map((entry) => entry.userId),
    ),
  ];
  return {
    ...listItemOf(row, actor),
    description: row.description,
    creator: safeUserRef(row.creatorId),
    observers: observers.map(safeUserRef),
    startDate: row.startDate,
    completedAt: row.completedAt,
    archivedAt: row.archivedAt,
    customFields: projectCustomFieldsOf(row),
    customFieldRefs: demoRefsForValues(projectCustomFieldsOf(row)),
    access: accessOf(row, membership, actor.permissions),
    structureSummary: structureSummaryOf(row.id),
    createdAt: row.createdAt,
  };
}

/** Секретный проект виден участию и `project.view_secret` (модель
 *  Битрикс-суперадмина); открытый — всем. */
export function canSeeProject(row: DemoProjectRow, actor: DemoActor): boolean {
  if (row.visibility === 'open') return true;
  if (actor.permissions.includes(Permission.PROJECT_VIEW_SECRET)) return true;
  return demoParticipantRowsOf(row.id).some((entry) => entry.userId === actor.id);
}

export function visibleProjectRows(actor: DemoActor): DemoProjectRow[] {
  return demoProjectRows.filter((row) => canSeeProject(row, actor));
}

export function demoProjectListFor(actor: DemoActor): ProjectListItem[] {
  return visibleProjectRows(actor).map((row) => listItemOf(row, actor));
}

/** Справочник мок-мира для потребителей, не знающих актёра (граф, задачи). */
export const demoProjects: ProjectListItem[] = demoProjectListFor(currentAuthUser);

export function demoProjectMembersFor(projectId: string): ProjectMember[] {
  const entries = demoParticipantRowsOf(projectId).sort(
    (a, b) =>
      a.userId.localeCompare(b.userId) ||
      SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
  );
  return entries.map((entry) => ({
    user: safeUserRef(entry.userId),
    source: entry.source,
    observerKind: entry.observerKind,
    joinedAt: entry.joinedAt,
  }));
}

export function isDemoProjectParticipant(id: string, actor: DemoActor): boolean {
  return demoParticipantRowsOf(id).some((entry) => entry.userId === actor.id);
}

/** Участие в канале: любой источник; для ростера канала. */
export function demoProjectRoster(id: string): { managerId: string; memberIds: string[] } | null {
  const row = findDemoProjectRow(id);
  if (!row) return null;
  return {
    managerId: row.managerId,
    memberIds: participantIdsOf(id).filter((userId) => userId !== row.managerId),
  };
}

/** Событие истории мок-мира → DTO (актор и люди — ссылками справочника). */
export function historyEntryOf(event: DemoProjectEvent): ProjectHistoryEntry {
  return {
    id: event.id,
    kind: event.kind,
    actor: event.actorId ? safeUserRef(event.actorId) : null,
    createdAt: event.createdAt,
    fields: event.fields,
    status: event.status,
    users: event.userIds.map(safeUserRef),
    members: event.members.map((change) => ({
      user: safeUserRef(change.userId),
      action: change.action,
      from: change.from,
      to: change.to,
    })),
    reason: event.reason,
    visibility: event.visibility,
    automatic: event.automatic ?? false,
    name: event.name,
  };
}
