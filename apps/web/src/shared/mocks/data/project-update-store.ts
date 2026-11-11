import {
  SYSTEM_FIELD_IDS,
  type ProjectParticipantChange,
  type UpdateProjectBody,
} from '@nodus/contracts';

import { appendDemoProjectEvent } from './project-events.js';
import {
  demoParticipantRowsOf,
  findDemoProjectRow,
  removeDemoParticipant,
  type DemoProjectRow,
} from './projects.js';
import { syncLegacyFields, syncManagement, touch } from './project-store.js';

/**
 * Правка полей мок-мира проектов (#699): зеркало серверных правил — в
 * `fields` попадают только реальные отличия (окно шлёт форму целиком), а
 * смена видимости чистит состав (#714) отдельной системной строкой истории.
 * Вынесено из project-store.ts ради лимита файла (I5); данные — projects.ts.
 */
export function updateDemoProject(
  id: string,
  body: UpdateProjectBody,
  actorId: string,
): DemoProjectRow | null {
  const row = findDemoProjectRow(id);
  if (!row) return null;
  const fields: string[] = [];
  const before = { ...row.customFields };
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
  if (body.name !== undefined && body.name !== row.name) {
    row.name = body.name;
    fields.push('name');
  }
  if (body.description !== undefined && (body.description ?? '') !== row.description) {
    row.description = body.description ?? '';
    fields.push('description');
  }
  if (body.color !== undefined && body.color !== row.color) {
    row.color = body.color;
    fields.push('color');
  }
  if (body.portfolioId !== undefined && (body.portfolioId ?? null) !== row.portfolioId) {
    row.portfolioId = body.portfolioId ?? null;
    fields.push('portfolioId');
  }
  const previousVisibility = row.visibility;
  if (body.visibility !== undefined) row.visibility = body.visibility;
  if (body.visibility !== undefined && body.visibility !== previousVisibility) {
    fields.push('visibility');
  }
  if (body.startDate !== undefined && (body.startDate ?? null) !== row.startDate) {
    row.startDate = body.startDate ?? null;
    fields.push('startDate');
  }
  if (body.endDate !== undefined && (body.endDate ?? null) !== row.endDate) {
    row.endDate = body.endDate ?? null;
    fields.push('endDate');
  }
  if (body.assistantIds !== undefined) {
    const next = [...new Set(body.assistantIds)].filter((entry) => entry !== row.managerId);
    if (!sameIds(next, row.assistantIds)) {
      row.assistantIds = next;
      syncManagement(row);
      fields.push('assistantIds');
    }
  }
  if (body.customFields) {
    for (const [fieldId, value] of Object.entries(body.customFields)) {
      if (value === null) delete row.customFields[fieldId];
      else row.customFields[fieldId] = value as never;
    }
  }
  syncLegacyFields(row);
  touch(row);
  // Смена видимости тянет состав — отдельная системная строка с причиной
  // (#699/#714); values «было → стало» в историю не пишутся.
  if (body.visibility !== undefined && body.visibility !== previousVisibility) {
    const dropped =
      body.visibility === 'open'
        ? removeRosterRows(id, (entry) => entry.source === 'member')
        : removeRosterRows(
            id,
            (entry) =>
              entry.source === 'task' ||
              (entry.source === 'observer' && entry.observerKind === 'joined'),
          );
    if (dropped.length > 0) {
      appendDemoProjectEvent({
        projectId: id,
        kind: 'participants_changed',
        actorId: null,
        fields: [],
        status: null,
        userIds: dropped.map((change) => change.userId),
        members: dropped,
        reason: 'visibility',
        visibility: body.visibility,
        name: null,
      });
    }
  }
  const changedCustom = new Set([...Object.keys(before), ...Object.keys(row.customFields)]);
  const changedFields = [...changedCustom]
    .filter(
      (fieldId) => JSON.stringify(before[fieldId]) !== JSON.stringify(row.customFields[fieldId]),
    )
    .map((fieldId) => `cf.${fieldId}`);
  fields.push(...changedFields);
  if (fields.length > 0) {
    appendDemoProjectEvent({
      projectId: row.id,
      kind: 'updated',
      actorId,
      fields,
      status: null,
      userIds: [],
      members: [],
      reason: null,
      visibility: null,
      name: null,
    });
  }
  return row;
}

/** Снятие строк состава по предикату: одна запись истории на сотрудника. */
function removeRosterRows(
  projectId: string,
  predicate: (entry: ReturnType<typeof demoParticipantRowsOf>[number]) => boolean,
): ProjectParticipantChange[] {
  const rows = demoParticipantRowsOf(projectId).filter(predicate);
  const byUser = new Map<string, ProjectParticipantChange>();
  for (const row of rows) {
    if (!byUser.has(row.userId)) {
      byUser.set(row.userId, {
        userId: row.userId,
        action: 'removed',
        from: row.source,
        to: null,
      });
    }
  }
  for (const row of rows) removeDemoParticipant(projectId, row.userId, row.source);
  return [...byUser.values()];
}

/** Равны ли множества идентификаторов. */
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((id) => b.has(id));
}
