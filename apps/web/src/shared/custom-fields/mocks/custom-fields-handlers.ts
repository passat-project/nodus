import { http, HttpResponse } from 'msw';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldScope,
  CustomFieldUsage,
  ReorderCustomFieldsBody,
  UpdateCustomFieldBody,
} from '@nodus/contracts';
import {
  createCustomFieldBodySchema,
  CUSTOM_FIELD_LIMITS,
  ErrorCode,
  isCompatibleTypeChange,
  reorderCustomFieldsBodySchema,
  updateCustomFieldBodySchema,
} from '@nodus/contracts';

import { projectsAvailable } from '../../api/projects-available.js';
import { dictionaryById } from '../../mocks/data/dictionaries.js';
import { demoCustomFieldDefinitions, demoFieldById } from '../../mocks/data/custom-fields.js';
import { demoRefsForValues } from '../../mocks/data/custom-fields-refs.js';
import { demoNodeKinds, demoNodeRows } from '../../mocks/data/project-nodes.js';
import { demoSubtasks, demoTasks } from '../../mocks/data/tasks.js';
import { mockTypes } from '../../mocks/data/process-types-store.js';
import { workflowsUsingField } from '../../mocks/data/workflows-store.js';

/** Мок-сервер реестра атрибутов (#431): правила те же, что у бэкенда —
 *  имя уникально в области, лимит области, белый список смены типа,
 *  справочник неизменен, «Проект» доступен только в мок-мире проектов,
 *  удаление запрещено, пока атрибут стоит в маршрутах процессов. */

const SCOPE_ORDER: CustomFieldScope[] = ['task', 'letter', 'project', 'node', 'counterparty'];

function dto(definition: CustomFieldDefinition): CustomFieldDefinition {
  const dictionary = definition.settings.dictionaryId
    ? dictionaryById(definition.settings.dictionaryId)
    : definition.type === 'money' && definition.settings.currencyId
      ? dictionaryById('d1000000-0000-4000-8000-000000000001')
      : undefined;
  const defaultRefs =
    definition.defaultValue?.kind === 'static'
      ? demoRefsForValues({ [definition.id]: definition.defaultValue.value })
      : [];
  return {
    ...definition,
    defaultRefs,
    dictionary: dictionary
      ? {
          id: dictionary.id,
          code: dictionary.code,
          name: dictionary.name,
          isSystem: dictionary.isSystem,
        }
      : null,
  };
}

function error(code: string, message: string, status: number, details?: unknown) {
  return HttpResponse.json({ code, message, ...(details ? { details } : {}) }, { status });
}

function nameTaken(scope: CustomFieldScope, name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  return demoCustomFieldDefinitions.some(
    (entry) =>
      entry.scope === scope && entry.id !== exceptId && entry.name.trim().toLowerCase() === key,
  );
}

function scopeCount(scope: CustomFieldScope): number {
  return demoCustomFieldDefinitions.filter((entry) => entry.scope === scope).length;
}

/** Сущности со значением атрибута: задачи (включая подзадачи) и папки. */
function entitiesWithValue(definition: CustomFieldDefinition) {
  if (definition.scope === 'node') {
    return demoNodeRows.filter((node) => node.customFields[definition.id] !== undefined);
  }
  if (definition.scope !== 'task') return [];
  return [...demoTasks, ...Object.values(demoSubtasks).flat()].filter(
    (task) => task.customFields?.[definition.id] !== undefined,
  );
}

/** Виды папок, в форме которых стоит атрибут (usage области node, #556). */
function kindsUsingField(fieldId: string) {
  return demoNodeKinds
    .filter((kind) => kind.form.fields.some((slot) => slot.fieldId === fieldId))
    .map((kind) => ({ id: kind.id, name: kind.name }));
}

export const customFieldsHandlers = [
  http.get('/api/v1/custom-fields/definitions', ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') as CustomFieldScope | null;
    const items = demoCustomFieldDefinitions
      .filter((entry) => (scope ? entry.scope === scope : true))
      .sort(
        (a, b) =>
          SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) ||
          a.sortOrder - b.sortOrder ||
          a.id.localeCompare(b.id),
      )
      .map(dto);
    return HttpResponse.json(items);
  }),

  http.post('/api/v1/custom-fields/definitions', async ({ request }) => {
    const parsed = createCustomFieldBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422, parsed.error.issues);
    }
    const body: CreateCustomFieldBody = parsed.data;
    if (body.type === 'project' && !projectsAvailable()) {
      return error(ErrorCode.CUSTOM_FIELD_TYPE_UNAVAILABLE, 'Project fields unavailable', 422);
    }
    if (body.settings.dictionaryId && !dictionaryById(body.settings.dictionaryId)) {
      return error(ErrorCode.VALIDATION_FAILED, 'Dictionary not found', 422);
    }
    if (nameTaken(body.scope, body.name)) {
      return error(ErrorCode.CUSTOM_FIELD_NAME_TAKEN, 'Name is taken', 409);
    }
    if (scopeCount(body.scope) >= CUSTOM_FIELD_LIMITS.perScope) {
      return error(ErrorCode.CUSTOM_FIELD_LIMIT_REACHED, 'Field limit reached', 409);
    }
    const now = new Date().toISOString();
    const maxOrder = Math.max(
      -1,
      ...demoCustomFieldDefinitions
        .filter((entry) => entry.scope === body.scope)
        .map((entry) => entry.sortOrder),
    );
    const definition: CustomFieldDefinition = {
      id: crypto.randomUUID(),
      scope: body.scope,
      type: body.type,
      name: body.name,
      hint: body.hint ?? null,
      settings: body.settings,
      dictionary: null,
      defaultValue: body.defaultValue ?? null,
      defaultRefs: [],
      reportIndexed: body.reportIndexed,
      hidden: body.hidden,
      typeIds: body.typeIds ?? [],
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    demoCustomFieldDefinitions.push(definition);
    return HttpResponse.json(dto(definition), { status: 201 });
  }),

  // Порядок — ДО '/definitions/:id' (gotcha msw-query: буквальный путь раньше).
  http.put('/api/v1/custom-fields/definitions/order', async ({ request }) => {
    const parsed = reorderCustomFieldsBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422);
    }
    const body: ReorderCustomFieldsBody = parsed.data;
    const ids = new Set(
      demoCustomFieldDefinitions
        .filter((entry) => entry.scope === body.scope)
        .map((entry) => entry.id),
    );
    if (body.ids.length !== ids.size || body.ids.some((id) => !ids.has(id))) {
      return error(ErrorCode.CONFLICT, 'Order is stale', 409);
    }
    body.ids.forEach((id, index) => {
      const definition = demoFieldById(id);
      if (definition) definition.sortOrder = index;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  // Точечная привязка к типу (#432, Р8) — идемпотентна; снятие при
  // использовании в опубликованном маршруте типа — 409 (путь с typeId
  // раньше `:id`, gotcha msw-query).
  http.put('/api/v1/custom-fields/definitions/:id/types/:typeId', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const type = mockTypes.find((entry) => entry.id === params.typeId);
    if (!type) return error(ErrorCode.NOT_FOUND, 'Process type not found', 404);
    if (definition.scope !== type.category) {
      return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Scope does not match type', 422, {
        typeIds: [type.id],
      });
    }
    if (!definition.typeIds.includes(type.id))
      definition.typeIds = [...definition.typeIds, type.id];
    definition.updatedAt = new Date().toISOString();
    return HttpResponse.json(dto(definition));
  }),

  http.delete('/api/v1/custom-fields/definitions/:id/types/:typeId', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const type = mockTypes.find((entry) => entry.id === params.typeId);
    if (!type) return error(ErrorCode.NOT_FOUND, 'Process type not found', 404);
    // Снятие привязки при использовании в опубликованном маршруте типа:
    // форма создания, окно перехода или условие (409 CUSTOM_FIELD_IN_USE).
    const inWorkflow = workflowsUsingField(definition.id).some(
      (entry) => entry.id === type.workflowId,
    );
    if (inWorkflow) {
      return error(ErrorCode.CUSTOM_FIELD_IN_USE, 'Field is used by the type workflow', 409, {
        workflows: workflowsUsingField(definition.id).filter((e) => e.id === type.workflowId),
      });
    }
    definition.typeIds = definition.typeIds.filter((id) => id !== type.id);
    definition.updatedAt = new Date().toISOString();
    return HttpResponse.json(dto(definition));
  }),

  http.patch('/api/v1/custom-fields/definitions/:id', async ({ params, request }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const parsed = updateCustomFieldBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422, parsed.error.issues);
    }
    const body: UpdateCustomFieldBody = parsed.data;
    if (body.type && !isCompatibleTypeChange(definition.type, body.type)) {
      return error(
        ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE,
        'Type change is incompatible',
        409,
        {
          from: definition.type,
          to: body.type,
        },
      );
    }
    if (body.name && nameTaken(definition.scope, body.name, definition.id)) {
      return error(ErrorCode.CUSTOM_FIELD_NAME_TAKEN, 'Name is taken', 409);
    }
    if (body.name !== undefined) definition.name = body.name;
    if (body.hint !== undefined) definition.hint = body.hint;
    if (body.type !== undefined) definition.type = body.type;
    if (body.reportIndexed !== undefined) definition.reportIndexed = body.reportIndexed;
    if (body.hidden !== undefined) definition.hidden = body.hidden;
    if (body.defaultValue !== undefined) definition.defaultValue = body.defaultValue;
    if (body.settings !== undefined)
      definition.settings = { ...definition.settings, ...body.settings };
    if (body.typeIds !== undefined) definition.typeIds = body.typeIds;
    definition.updatedAt = new Date().toISOString();
    return HttpResponse.json(dto(definition));
  }),

  http.get('/api/v1/custom-fields/definitions/:id/usage', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const usage: CustomFieldUsage = {
      valueCount: entitiesWithValue(definition).length,
      workflows: workflowsUsingField(definition.id),
      nodeKinds: definition.scope === 'node' ? kindsUsingField(definition.id) : [],
    };
    return HttpResponse.json(usage);
  }),

  http.delete('/api/v1/custom-fields/definitions/:id', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const workflows = workflowsUsingField(definition.id);
    if (workflows.length > 0) {
      return error(ErrorCode.CUSTOM_FIELD_IN_USE, 'Field is used by workflows', 409, {
        workflows,
      });
    }
    // Уборка значений (Р11): задачи и папки; формы видов теряют атрибут.
    for (const task of entitiesWithValue(definition)) {
      const next = { ...task.customFields };
      delete next[definition.id];
      task.customFields = next;
    }
    for (const kind of demoNodeKinds) {
      kind.form = {
        ...kind.form,
        fields: kind.form.fields.filter((slot) => slot.fieldId !== definition.id),
      };
    }
    demoCustomFieldDefinitions.splice(demoCustomFieldDefinitions.indexOf(definition), 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
