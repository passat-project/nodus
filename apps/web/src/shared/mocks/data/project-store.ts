import { SYSTEM_FIELD_IDS, type CreateProjectBody, type ProjectStatus } from '@nodus/contracts';

import { appendDemoProjectEvent } from './project-events.js';
import {
  addDemoParticipant,
  demoParticipantRowsOf,
  demoProjectRows,
  findDemoProjectRow,
  removeDemoParticipant,
  type DemoProjectRow,
} from './projects.js';
import type { DemoActor } from './project-views.js';

/** Мутации мок-мира проектов (#52): зеркало серверных правил для приёмки
 *  демо-сборки. Данные — `projects.ts`, чтение/DTO — `project-views.ts`. */

/** Подъём активности строки проекта (updated_at) — общий для мутаций мока. */
export function touch(row: DemoProjectRow): void {
  row.updatedAt = new Date().toISOString();
}

/** `code`/`clientId` строки — производные системных атрибутов (#631):
 *  мок обязан держать их в синхроне, иначе журнал/поиск/пикер врут. */
export function syncLegacyFields(row: DemoProjectRow): void {
  const code = row.customFields[SYSTEM_FIELD_IDS.projectCode];
  row.code = typeof code === 'string' && code !== '' ? code : null;
  const client = row.customFields[SYSTEM_FIELD_IDS.projectClient];
  row.clientId = typeof client === 'string' && client !== '' ? client : null;
}

/** Строки руководства мока из полей проекта (create/update/transfer). */
export function syncManagement(row: DemoProjectRow): void {
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
    // Новый проект всегда открытый, если не выбрано иное (#738).
    visibility: body.visibility ?? 'open',
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
    members: [],
    reason: null,
    visibility: null,
    name: row.name,
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
    members: [],
    reason: null,
    visibility: null,
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
  // Синк руководства — автоматический пересчёт состава (roster_synced на
  // сервере): в историю идёт строка изменённых полей, не «изменён состав».
  appendDemoProjectEvent({
    projectId: id,
    kind: 'updated',
    actorId,
    fields: ['managerId', 'assistantIds'],
    status: null,
    userIds: [],
    members: [],
    reason: null,
    visibility: null,
    name: null,
  });
  return row;
}
