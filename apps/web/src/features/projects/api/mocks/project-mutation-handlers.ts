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
  projectStatusBodySchema,
  projectTransferBodySchema,
  requiredProjectFields,
  updateProjectBodySchema,
} from '@nodus/contracts';
import type { CustomFieldValues } from '@nodus/contracts';

import { counterpartyRefById } from '../../../../shared/mocks/data/counterparties.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { definitionsForTarget } from '../../../../shared/custom-fields/module-target.js';
import { projectWithFormulas } from '../../../../shared/custom-fields/formula/formula-dto.js';
import { lockedPatchResponse } from '../../../../shared/custom-fields/formula/formula-mocks.js';
import {
  invalidMockValues,
  withStaticDefaults,
} from '../../../../shared/custom-fields/mocks/custom-fields-mock-utils.js';
import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { accessOf, detailOf, myMembershipOf } from '../../../../shared/mocks/data/project-views.js';
import {
  createDemoProject,
  setDemoProjectStatus,
  transferDemoProject,
} from '../../../../shared/mocks/data/project-store.js';
import { updateDemoProject } from '../../../../shared/mocks/data/project-update-store.js';
import {
  demoProjectGroups,
  demoProjectTypes,
  findDemoProjectRow,
} from '../../../../shared/mocks/data/projects.js';
import { forbidden, invalid, notFound } from './project-mutation-responses.js';

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
import {
  placeOfNewProject,
  planOnCreate,
  stripCounterValues,
} from '../../../../shared/mocks/data/numbering-create.js';
import {
  counterWriteResponse,
  numberingFailureResponse,
} from '../../../../shared/custom-fields/mocks/numbering-responses.js';

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
    // Счётчики «при создании» (#630, модель v3): номер из тела отбрасывается;
    // портфель/тип — ДО создания (нет портфеля при «каждого портфеля» —
    // 409, проект не создаётся, номер не тратится).
    const clean = stripCounterValues(values);
    const numbering = planOnCreate(
      placeOfNewProject(type.id, body.portfolioId ?? null, clean),
      clean,
      {
        source: 'create',
        confirmEmpty: body.confirmEmptyNumberParts === true,
      },
    );
    if (!numbering.ok) return numberingFailureResponse(numbering.failure);
    const row = createDemoProject({ ...body, customFields: clean as CustomFieldValues }, actor);
    const numbers = numbering.issue(row.id);
    if (Object.keys(numbers).length > 0) row.customFields = { ...row.customFields, ...numbers };
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
    const lockedProject = lockedPatchResponse('project', row.id, row.customFields, values);
    if (lockedProject) return lockedProject;
    // Номер счётчика руками не пишется (#630): 422 NUMBER_CELL_IMMUTABLE.
    const counterWrite = counterWriteResponse(values);
    if (counterWrite) return counterWrite;
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
];
