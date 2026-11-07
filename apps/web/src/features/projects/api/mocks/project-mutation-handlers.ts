import { http, HttpResponse } from 'msw';
import {
  clearedProjectFields,
  customFieldKey,
  effectiveProjectTypeForm,
  ErrorCode,
  missingProjectFields,
  Permission,
  SYSTEM_FIELD_IDS,
  createProjectBodySchema,
  projectMemberAddBodySchema,
  projectStatusBodySchema,
  projectTransferBodySchema,
  requiredProjectFields,
  updateProjectBodySchema,
} from '@nodus/contracts';
import type { CustomFieldValues } from '@nodus/contracts';

import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { counterpartyRefById } from '../../../../shared/mocks/data/counterparties.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { definitionsForTarget } from '../../../../shared/custom-fields/module-target.js';
import { projectWithFormulas } from '../../../../shared/custom-fields/formula/formula-dto.js';
import { mockLockedFieldError } from '../../../../shared/custom-fields/formula/formula-mocks.js';
import {
  invalidMockValues,
  withStaticDefaults,
} from '../../../../shared/custom-fields/mocks/custom-fields-mock-utils.js';
import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { accessOf, detailOf, myMembershipOf } from '../../../../shared/mocks/data/project-views.js';
import {
  addDemoProjectMember,
  createDemoProject,
  joinDemoProject,
  leaveDemoProject,
  removeDemoProjectMember,
  setDemoProjectStatus,
  transferDemoProject,
  updateDemoProject,
} from '../../../../shared/mocks/data/project-store.js';
import {
  demoProjectGroups,
  demoProjectTypes,
  findDemoProjectRow,
} from '../../../../shared/mocks/data/projects.js';

const invalid = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 400 },
  );
const forbidden = () =>
  HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });
const notFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Project not found' }, { status: 404 });
const fieldsRequired = (typeId: string, fields: string[], reason: 'create' | 'clear') =>
  HttpResponse.json(
    {
      code: ErrorCode.PROJECT_FIELDS_REQUIRED,
      message: 'Required project fields are missing',
      details: { typeId, fields: fields.map(customFieldKey), reason },
    },
    { status: 422 },
  );
const valuesInvalid = (fieldIds: string[]) =>
  HttpResponse.json(
    {
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      message: 'Custom field values are invalid',
      details: {
        issues: fieldIds.map((fieldId) => ({
          fieldId,
          reason: 'not_in_type',
          message: 'Field is not bound to this place',
        })),
      },
    },
    { status: 422 },
  );

/** Значения тела проекта: legacy code/clientId — системные атрибуты (Р9),
 *  как `legacyToAttributes` сервера. */
function valuesOfBody(body: {
  code?: string | null;
  clientId?: string | null;
  customFields?: Record<string, unknown>;
}): Record<string, unknown> {
  const values: Record<string, unknown> = { ...(body.customFields ?? {}) };
  if (body.code && values[SYSTEM_FIELD_IDS.projectCode] === undefined) {
    values[SYSTEM_FIELD_IDS.projectCode] = body.code;
  }
  if (body.clientId && values[SYSTEM_FIELD_IDS.projectClient] === undefined) {
    values[SYSTEM_FIELD_IDS.projectClient] = body.clientId;
  }
  return values;
}

/** Запись проектов в моках (#52): создание/правка/статусы/руководство/
 *  участие — зеркало серверных правил, чтобы приёмка на демо-мире видела
 *  те же отказы (I8 на клиенте — только UX, сервер в проде истина). */
export const projectMutationHandlers = [
  http.post('/api/v1/projects', async ({ request }) => {
    const actor = getMockActor();
    if (!actor.permissions.includes(Permission.PROJECT_CREATE)) return forbidden();
    const parsed = createProjectBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const body = parsed.data;
    const type = demoProjectTypes.find((entry) => entry.id === body.typeId);
    if (!type || type.archivedAt !== null) return invalid();
    if (body.portfolioId) {
      const portfolio = demoProjectGroups.find((entry) => entry.id === body.portfolioId);
      if (!portfolio || portfolio.archivedAt !== null) return invalid();
    }
    if (body.clientId && !counterpartyRefById(body.clientId)) return invalid();
    // Значение разрешает ПРИВЯЗКА (binding), а не слот формы: слот — только
    // видимость. Форма для required — эффективная (удалённые слоты не в счёт).
    const boundDefinitions = definitionsForTarget(demoCustomFieldDefinitions, 'project', type.id);
    const form = effectiveProjectTypeForm(type, boundDefinitions);
    const bound = new Set(boundDefinitions.map((definition) => definition.id));
    const values = withStaticDefaults(boundDefinitions, valuesOfBody(body) as CustomFieldValues);
    const unknown = Object.keys(values).filter(
      (fieldId) => values[fieldId] !== null && !bound.has(fieldId),
    );
    if (unknown.length > 0) return valuesInvalid(unknown);
    const malformed = invalidMockValues(boundDefinitions, values);
    if (malformed.length > 0) return valuesInvalid(malformed);
    const missing = missingProjectFields(form, { customFields: values });
    if (missing.length > 0) return fieldsRequired(type.id, missing, 'create');
    const row = createDemoProject({ ...body, customFields: values as CustomFieldValues }, actor);
    return HttpResponse.json(detailOf(row, actor), { status: 201 });
  }),

  http.patch('/api/v1/projects/:id', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManage) return forbidden();
    if (row.status === 'archived' && !actor.permissions.includes(Permission.PROJECT_MANAGE)) {
      return forbidden();
    }
    const parsed = updateProjectBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const body = parsed.data;
    if (
      body.visibility === 'secret' &&
      row.visibility !== 'secret' &&
      row.managerId !== actor.id &&
      !actor.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      return forbidden();
    }
    if (body.portfolioId) {
      const portfolio = demoProjectGroups.find((entry) => entry.id === body.portfolioId);
      if (!portfolio || portfolio.archivedAt !== null) return invalid();
    }
    if (body.clientId && !counterpartyRefById(body.clientId)) return invalid();
    const type = demoProjectTypes.find((entry) => entry.id === row.typeId);
    if (!type) return invalid();
    const boundDefinitions = definitionsForTarget(demoCustomFieldDefinitions, 'project', type.id);
    const form = effectiveProjectTypeForm(type, boundDefinitions);
    const bound = new Set(boundDefinitions.map((definition) => definition.id));
    const values = valuesOfBody(body);
    // `null` — очистка: разрешена всегда, даже для снятого с типа атрибута.
    if (body.code === null) values[SYSTEM_FIELD_IDS.projectCode] = null;
    if (body.clientId === null) values[SYSTEM_FIELD_IDS.projectClient] = null;
    const unknown = Object.keys(values).filter(
      (fieldId) => values[fieldId] !== null && !bound.has(fieldId),
    );
    if (unknown.length > 0) return valuesInvalid(unknown);
    const malformed = invalidMockValues(boundDefinitions, values as CustomFieldValues);
    if (malformed.length > 0) return valuesInvalid(malformed);
    const cleared = clearedProjectFields(requiredProjectFields(form), values);
    if (cleared.length > 0) return fieldsRequired(type.id, cleared, 'clear');
    // Формульная ячейка руками не пишется (#660): 422, как на сервере.
    const lockedProject = mockLockedFieldError('project', row.id, values);
    if (lockedProject) return HttpResponse.json(lockedProject, { status: 422 });
    const updated = updateDemoProject(row.id, body, actor.id);
    return updated
      ? HttpResponse.json(projectWithFormulas(detailOf(updated, actor), updated.typeId))
      : notFound();
  }),

  http.post('/api/v1/projects/:id/status', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManage) return forbidden();
    if (
      row.status === 'archived' &&
      row.managerId !== actor.id &&
      !actor.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      return forbidden();
    }
    const parsed = projectStatusBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const updated = setDemoProjectStatus(row.id, parsed.data.status, actor.id);
    return updated ? HttpResponse.json(detailOf(updated, actor)) : notFound();
  }),

  http.post('/api/v1/projects/:id/transfer', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    if (row.managerId !== actor.id) return forbidden();
    const parsed = projectTransferBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const target = demoUserListItems.find(
      (user) => user.id === parsed.data.managerId && user.status === 'active',
    );
    if (!target) return notFound();
    const updated = transferDemoProject(row.id, target.id, actor.id);
    return updated ? HttpResponse.json(detailOf(updated, actor)) : notFound();
  }),

  http.post('/api/v1/projects/:id/join', ({ params }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row || row.visibility !== 'open') return notFound();
    joinDemoProject(row.id, actor);
    return new HttpResponse(null, { status: 200 });
  }),

  http.post('/api/v1/projects/:id/leave', ({ params }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    leaveDemoProject(row.id, actor);
    return new HttpResponse(null, { status: 200 });
  }),

  http.post('/api/v1/projects/:id/members', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManageMembers) return forbidden();
    const parsed = projectMemberAddBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    // Открытый проект: участники живут из задач, руками — только наблюдатель.
    if (row.visibility !== 'secret' && parsed.data.kind === 'member') return invalid();
    const target = demoUserListItems.find(
      (user) => user.id === parsed.data.userId && user.status === 'active',
    );
    if (!target) return notFound();
    addDemoProjectMember(row.id, target.id, parsed.data.kind, actor.id);
    return new HttpResponse(null, { status: 201 });
  }),

  http.delete('/api/v1/projects/:id/members/:userId', ({ params }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManageMembers) return forbidden();
    removeDemoProjectMember(row.id, String(params.userId), actor.id, row.visibility !== 'secret');
    return new HttpResponse(null, { status: 200 });
  }),
];
