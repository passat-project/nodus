import {
  SYSTEM_FIELD_IDS,
  type CreateProjectBody,
  type ProjectStatus,
  type UpdateProjectBody,
} from '@nodus/contracts';

import { appendDemoProjectEvent } from './project-events.js';
import {
  addDemoParticipant,
  demoParticipantRowsOf,
  demoPortalSettings,
  demoProjectRows,
  findDemoProjectRow,
  removeDemoParticipant,
  type DemoProjectRow,
} from './projects.js';
import type { DemoActor } from './project-views.js';

/** Мутации мок-мира проектов (#52): зеркало серверных правил для приёмки
 *  демо-сборки. Данные — `projects.ts`, чтение/DTO — `project-views.ts`. */

export function defaultVisibility(): 'open' | 'secret' {
  return demoPortalSettings.projects.defaultVisibility;
}

function touch(row: DemoProjectRow): void {
  row.updatedAt = new Date().toISOString();
}

/** `code`/`clientId` строки — производные системных атрибутов (#631):
 *  мок обязан держать их в синхроне, иначе журнал/поиск/пикер врут. */
function syncLegacyFields(row: DemoProjectRow): void {
  const code = row.customFields[SYSTEM_FIELD_IDS.projectCode];
  row.code = typeof code === 'string' && code !== '' ? code : null;
  const client = row.customFields[SYSTEM_FIELD_IDS.projectClient];
  row.clientId = typeof client === 'string' && client !== '' ? client : null;
}

function syncManagement(row: DemoProjectRow): void {
  for (const entry of demoParticipantRowsOf(row.id)) {
    if (entry.source === 'manager' || entry.source === 'assistant') {
      removeDemoParticipant(row.id, entry.userId, entry.source);
    }
  }
  addDemoParticipant({
    projectId: row.id,
    userId: row.managerId,
    source: 'manager',
    observerKind: null,
    joinedAt: new Date().toISOString(),
  });
  for (const assistantId of row.assistantIds) {
    if (assistantId === row.managerId) continue;
    addDemoParticipant({
      projectId: row.id,
      userId: assistantId,
      source: 'assistant',
      observerKind: null,
      joinedAt: new Date().toISOString(),
    });
  }
}

export function createDemoProject(body: CreateProjectBody, actor: DemoActor): DemoProjectRow {
  const now = new Date().toISOString();
  const managerId = body.managerId ?? actor.id;
  const row: DemoProjectRow = {
    id: crypto.randomUUID(),
    code: body.code ?? null,
    name: body.name,
    description: body.description ?? '',
    color: body.color ?? 'blue',
    typeId: body.typeId,
    portfolioId: body.portfolioId ?? null,
    clientId: body.clientId ?? null,
    managerId,
    assistantIds: [...new Set(body.assistantIds ?? [])].filter((id) => id !== managerId),
    visibility: body.visibility ?? defaultVisibility(),
    status: 'active',
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    completedAt: null,
    archivedAt: null,
    // Значения атрибутов создания (#631): мок обязан сохранять их так же,
    // как сервер, иначе «Шифр»/«Заказчик» теряются на :5173.
    customFields: { ...(body.customFields ?? {}) },
    creatorId: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  syncLegacyFields(row);
  demoProjectRows.unshift(row);
  syncManagement(row);
  for (const observerId of new Set(body.observers ?? [])) {
    if (observerId === managerId || row.assistantIds.includes(observerId)) continue;
    addDemoParticipant({
      projectId: row.id,
      userId: observerId,
      source: 'observer',
      observerKind: 'invited',
      joinedAt: now,
    });
  }
  if (managerId !== actor.id) {
    addDemoParticipant({
      projectId: row.id,
      userId: actor.id,
      source: 'observer',
      observerKind: 'creator',
      joinedAt: now,
    });
  }
  appendDemoProjectEvent({
    projectId: row.id,
    kind: 'created',
    actorId: actor.id,
    fields: [],
    status: null,
    userIds: [],
    name: row.name,
  });
  return row;
}

export function updateDemoProject(
  id: string,
  body: UpdateProjectBody,
  actorId: string,
): DemoProjectRow | null {
  const row = findDemoProjectRow(id);
  if (!row) return null;
  // Legacy-поля идут в те же системные атрибуты, что и на сервере; явное
  // customFields ниже важнее (порядок как в project-legacy-fields.ts).
  if (body.code !== undefined) {
    if (body.code === null) delete row.customFields[SYSTEM_FIELD_IDS.projectCode];
    else row.customFields[SYSTEM_FIELD_IDS.projectCode] = body.code;
  }
  if (body.clientId !== undefined) {
    if (body.clientId === null) delete row.customFields[SYSTEM_FIELD_IDS.projectClient];
    else row.customFields[SYSTEM_FIELD_IDS.projectClient] = body.clientId;
  }
  if (body.name !== undefined) row.name = body.name;
  if (body.description !== undefined) row.description = body.description ?? '';
  if (body.color !== undefined) row.color = body.color;
  if (body.portfolioId !== undefined) row.portfolioId = body.portfolioId ?? null;
  if (body.visibility !== undefined) row.visibility = body.visibility;
  if (body.startDate !== undefined) row.startDate = body.startDate ?? null;
  if (body.endDate !== undefined) row.endDate = body.endDate ?? null;
  if (body.assistantIds !== undefined) {
    row.assistantIds = [...new Set(body.assistantIds)].filter((entry) => entry !== row.managerId);
    syncManagement(row);
  }
  if (body.customFields) {
    for (const [fieldId, value] of Object.entries(body.customFields)) {
      if (value === null) delete row.customFields[fieldId];
      else row.customFields[fieldId] = value as never;
    }
  }
  syncLegacyFields(row);
  touch(row);
  appendDemoProjectEvent({
    projectId: row.id,
    kind: 'updated',
    actorId,
    fields: Object.keys(body),
    status: null,
    userIds: [],
    name: null,
  });
  return row;
}

export function setDemoProjectStatus(
  id: string,
  status: ProjectStatus,
  actorId: string,
): DemoProjectRow | null {
  const row = findDemoProjectRow(id);
  if (!row) return null;
  row.status = status;
  row.completedAt = status === 'completed' ? new Date().toISOString() : null;
  row.archivedAt = status === 'archived' ? new Date().toISOString() : null;
  touch(row);
  appendDemoProjectEvent({
    projectId: row.id,
    kind: 'status_changed',
    actorId,
    fields: ['status'],
    status,
    userIds: [],
    name: null,
  });
  return row;
}

export function transferDemoProject(
  id: string,
  managerId: string,
  actorId: string,
): DemoProjectRow | null {
  const row = findDemoProjectRow(id);
  if (!row) return null;
  const previousManager = row.managerId;
  row.managerId = managerId;
  row.assistantIds = row.assistantIds.filter((entry) => entry !== managerId);
  syncManagement(row);
  const previousKeepsRole = demoParticipantRowsOf(id).some(
    (entry) =>
      entry.userId === previousManager &&
      ['assistant', 'task', 'member', 'observer'].includes(entry.source),
  );
  if (!previousKeepsRole) {
    addDemoParticipant({
      projectId: id,
      userId: previousManager,
      source: 'observer',
      observerKind: 'creator',
      joinedAt: new Date().toISOString(),
    });
  }
  touch(row);
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId,
    fields: [],
    status: null,
    userIds: [managerId, previousManager],
    name: null,
  });
  return row;
}

export function joinDemoProject(id: string, actor: DemoActor): boolean {
  const row = findDemoProjectRow(id);
  if (!row || row.visibility !== 'open') return false;
  if (demoParticipantRowsOf(id).some((entry) => entry.userId === actor.id)) return true;
  addDemoParticipant({
    projectId: id,
    userId: actor.id,
    source: 'observer',
    observerKind: 'joined',
    joinedAt: new Date().toISOString(),
  });
  touch(row);
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId: actor.id,
    fields: [],
    status: null,
    userIds: [actor.id],
    name: null,
  });
  return true;
}

export function leaveDemoProject(id: string, actor: DemoActor): void {
  removeDemoParticipant(id, actor.id, 'observer');
  const row = findDemoProjectRow(id);
  if (row) touch(row);
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId: actor.id,
    fields: [],
    status: null,
    userIds: [actor.id],
    name: null,
  });
}

export function addDemoProjectMember(
  id: string,
  userId: string,
  kind: 'member' | 'observer',
  actorId: string,
): boolean {
  const row = findDemoProjectRow(id);
  if (!row) return false;
  removeDemoParticipant(id, userId, kind === 'member' ? 'observer' : 'member');
  addDemoParticipant({
    projectId: id,
    userId,
    source: kind,
    observerKind: kind === 'observer' ? 'invited' : null,
    joinedAt: new Date().toISOString(),
  });
  touch(row);
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId,
    fields: [],
    status: null,
    userIds: [userId],
    name: null,
  });
  return true;
}

export function removeDemoProjectMember(
  id: string,
  userId: string,
  actorId: string,
  observerOnly = false,
): void {
  if (!observerOnly) removeDemoParticipant(id, userId, 'member');
  removeDemoParticipant(id, userId, 'observer');
  const row = findDemoProjectRow(id);
  if (row) touch(row);
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId,
    fields: [],
    status: null,
    userIds: [userId],
    name: null,
  });
}
