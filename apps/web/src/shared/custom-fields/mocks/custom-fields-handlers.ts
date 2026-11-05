import { http, HttpResponse } from 'msw';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldUsage,
  ReorderCustomFieldsBody,
  UpdateCustomFieldBody,
} from '@nodus/contracts';
import {
  createCustomFieldBodySchema,
  customFieldCompanyValueBodySchema,
  CUSTOM_FIELD_LIMITS,
  customFieldValueSchemaOf,
  ErrorCode,
  isCompatibleTypeChange,
  reorderCustomFieldsBodySchema,
  updateCustomFieldBodySchema,
} from '@nodus/contracts';

import { projectsAvailable } from '../../api/projects-available.js';
import { dictionaryById } from '../../mocks/data/dictionaries.js';
import {
  demoCustomFieldDefinitions,
  demoFieldById,
  nextFieldNumber,
} from '../../mocks/data/custom-fields.js';
import { demoRefsForValues } from '../../mocks/data/custom-fields-refs.js';
import { demoLetters } from '../../mocks/data/letters.js';
import { demoNodeKinds, demoNodeRows } from '../../mocks/data/project-nodes.js';
import { demoProjectRows, demoProjectTypes } from '../../mocks/data/projects.js';
import { demoSubtasks, demoTasks } from '../../mocks/data/tasks.js';
import { creationFormOf, mockTypes } from '../../mocks/data/process-types-store.js';
import { workflowsUsingField } from '../../mocks/data/workflows-store.js';
import { customFieldKey } from '@nodus/contracts';

/** Мок-сервер реестра атрибутов портала (#631): правила те же, что у
 *  бэкенда — имя уникально на портале (409 с suggestion существующего),
 *  потолок 1000, белый список смены типа, справочник неизменен, «Проект»
 *  доступен только в мок-мире проектов, привязки идемпотентны и всегда
 *  разрешены, удаление всегда разрешено (значения и формы чистятся).
 *  Глобальная переменная: одно значение, привязки запрещены. */

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

function nameTaken(name: string, exceptId?: string) {
  const key = name.trim().toLowerCase();
  return demoCustomFieldDefinitions.find(
    (entry) => entry.id !== exceptId && entry.name.trim().toLowerCase() === key,
  );
}

/** Категории демо-типов процессов (для фильтра module=task|letter). */
function typeCategorySets() {
  const taskTypeIds = new Set(
    mockTypes.filter((type) => type.category === 'task').map((type) => type.id),
  );
  const letterTypeIds = new Set(
    mockTypes.filter((type) => type.category === 'letter').map((type) => type.id),
  );
  return { taskTypeIds, letterTypeIds };
}

/** Валидация цели привязки: типы процессов, типы проектов, виды папок. */
function bindingTargetExists(kind: string, targetId: string): boolean {
  switch (kind) {
    case 'process-type':
      return mockTypes.some((type) => type.id === targetId && type.archivedAt === null);
    case 'project-type':
      return demoProjectTypes.some((type) => type.id === targetId);
    case 'node-kind':
      return demoNodeKinds.some((kind_) => kind_.id === targetId);
    default:
      return false;
  }
}

/** Сущности со значением атрибута — по всем носителям значений. */
function entitiesWithValue(fieldId: string) {
  const task = [...demoTasks, ...Object.values(demoSubtasks).flat()].filter(
    (entry) => entry.customFields?.[fieldId] !== undefined,
  );
  const letter = demoLetters.filter((entry) => entry.customFields[fieldId] !== undefined);
  const project = demoProjectRows.filter((entry) => entry.customFields[fieldId] !== undefined);
  const node = demoNodeRows.filter((entry) => entry.customFields[fieldId] !== undefined);
  return { task, letter, project, node };
}

/** Формы создания типов, где атрибут стоит слотом. */
function formsUsingField(fieldId: string) {
  const key = customFieldKey(fieldId);
  return mockTypes
    .filter((type) => creationFormOf(type).fields.some((slot) => slot.key === key) === true)
    .map((type) => ({ kind: type.category as 'task' | 'letter', name: type.name }));
}

export const customFieldsHandlers = [
  http.get('/api/v1/custom-fields/definitions', ({ request }) => {
    const url = new URL(request.url);
    const module = url.searchParams.get('module');
    const { taskTypeIds, letterTypeIds } = typeCategorySets();
    const items = demoCustomFieldDefinitions
      .filter((entry) => {
        switch (module) {
          case 'company':
            return entry.isCompany;
          case 'task':
            return entry.bindings.processTypeIds.some((id) => taskTypeIds.has(id));
          case 'letter':
            return entry.bindings.processTypeIds.some((id) => letterTypeIds.has(id));
          case 'project':
            return entry.bindings.projectTypeIds.length > 0;
          case 'node':
            return entry.bindings.nodeKindIds.length > 0;
          default:
            return true;
        }
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
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
    const existing = nameTaken(body.name);
    if (existing) {
      // В3: названия уникальны всегда; диалог предлагает открыть существующий.
      return error(ErrorCode.CUSTOM_FIELD_NAME_TAKEN, 'Name is taken', 409, {
        suggestion: { definitionId: existing.id, name: existing.name },
      });
    }
    if (demoCustomFieldDefinitions.length >= CUSTOM_FIELD_LIMITS.portal) {
      return error(ErrorCode.CUSTOM_FIELD_LIMIT_REACHED, 'Field limit reached', 409);
    }
    const bindings = body.isCompany
      ? { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] }
      : {
          processTypeIds: body.bindings?.processTypeIds ?? [],
          projectTypeIds: body.bindings?.projectTypeIds ?? [],
          nodeKindIds: body.bindings?.nodeKindIds ?? [],
        };
    for (const targetId of bindings.processTypeIds) {
      if (!bindingTargetExists('process-type', targetId)) {
        return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Process type not found', 422, {
          targetKind: 'process-type',
          targetId,
        });
      }
    }
    for (const targetId of bindings.projectTypeIds) {
      if (!bindingTargetExists('project-type', targetId)) {
        return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Project type not found', 422, {
          targetKind: 'project-type',
          targetId,
        });
      }
    }
    for (const targetId of bindings.nodeKindIds) {
      if (!bindingTargetExists('node-kind', targetId)) {
        return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Node kind not found', 422, {
          targetKind: 'node-kind',
          targetId,
        });
      }
    }
    const now = new Date().toISOString();
    const maxOrder = Math.max(-1, ...demoCustomFieldDefinitions.map((entry) => entry.sortOrder));
    const definition: CustomFieldDefinition = {
      id: crypto.randomUUID(),
      number: nextFieldNumber(),
      type: body.type,
      name: body.name,
      hint: body.hint ?? null,
      settings: body.settings,
      dictionary: null,
      defaultValue: body.defaultValue ?? null,
      defaultRefs: [],
      reportIndexed: body.reportIndexed,
      isCompany: body.isCompany,
      companyValue: null,
      bindings,
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
      return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422, parsed.error.issues);
    }
    const body: ReorderCustomFieldsBody = parsed.data;
    const ids = new Set(demoCustomFieldDefinitions.map((entry) => entry.id));
    if (body.ids.length !== ids.size || body.ids.some((id) => !ids.has(id))) {
      return error(ErrorCode.CONFLICT, 'Order is stale', 409);
    }
    body.ids.forEach((id, index) => {
      const definition = demoFieldById(id);
      if (definition) definition.sortOrder = index;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  // Точечная привязка к месту (#631, Р3) — идемпотентна и всегда разрешена
  // (запрет снят: unbind мягче delete, В4/О3). Путь с bindings раньше
  // `:id`-маршрутов, gotcha msw-query.
  http.put('/api/v1/custom-fields/definitions/:id/bindings/:kind/:targetId', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const kind = String(params.kind);
    const targetId = String(params.targetId);
    if (!bindingTargetExists(kind, targetId)) {
      return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Binding target not found', 422, {
        targetKind: kind,
        targetId,
      });
    }
    if (definition.isCompany) {
      return error(
        ErrorCode.CUSTOM_FIELD_BINDING_INVALID,
        'Company variable has no bindings',
        422,
        {
          targetKind: kind,
          targetId,
        },
      );
    }
    const list =
      kind === 'process-type'
        ? definition.bindings.processTypeIds
        : kind === 'project-type'
          ? definition.bindings.projectTypeIds
          : definition.bindings.nodeKindIds;
    if (!list.includes(targetId)) list.push(targetId);
    definition.updatedAt = new Date().toISOString();
    return HttpResponse.json(dto(definition));
  }),

  http.delete('/api/v1/custom-fields/definitions/:id/bindings/:kind/:targetId', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const kind = String(params.kind);
    const targetId = String(params.targetId);
    if (kind === 'process-type') {
      definition.bindings.processTypeIds = definition.bindings.processTypeIds.filter(
        (id) => id !== targetId,
      );
    } else if (kind === 'project-type') {
      definition.bindings.projectTypeIds = definition.bindings.projectTypeIds.filter(
        (id) => id !== targetId,
      );
    } else if (kind === 'node-kind') {
      definition.bindings.nodeKindIds = definition.bindings.nodeKindIds.filter(
        (id) => id !== targetId,
      );
    } else {
      return error(ErrorCode.VALIDATION_FAILED, 'Unknown binding kind', 422);
    }
    definition.updatedAt = new Date().toISOString();
    return HttpResponse.json(dto(definition));
  }),

  // Значение глобальной переменной (Р7): одно на компанию, грамматика типа.
  http.put('/api/v1/custom-fields/definitions/:id/company-value', async ({ params, request }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    if (!definition.isCompany) {
      return error(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, 'Not a company variable', 422);
    }
    const parsed = customFieldCompanyValueBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422, parsed.error.issues);
    }
    if (
      parsed.data.value !== null &&
      !customFieldValueSchemaOf(definition).safeParse(parsed.data.value).success
    ) {
      return error(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, 'Value does not match field type', 422);
    }
    definition.companyValue = parsed.data.value;
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
    if (body.name) {
      const existing = nameTaken(body.name, definition.id);
      if (existing) {
        return error(ErrorCode.CUSTOM_FIELD_NAME_TAKEN, 'Name is taken', 409, {
          suggestion: { definitionId: existing.id, name: existing.name },
        });
      }
    }
    if (body.name !== undefined) definition.name = body.name;
    if (body.hint !== undefined) definition.hint = body.hint;
    if (body.type !== undefined) definition.type = body.type;
    if (body.reportIndexed !== undefined) definition.reportIndexed = body.reportIndexed;
    if (body.defaultValue !== undefined) definition.defaultValue = body.defaultValue;
    if (body.settings !== undefined)
      definition.settings = { ...definition.settings, ...body.settings };
    if (body.bindings !== undefined) {
      if (definition.isCompany) {
        return error(
          ErrorCode.CUSTOM_FIELD_BINDING_INVALID,
          'Company variable has no bindings',
          422,
        );
      }
      for (const targetId of body.bindings.processTypeIds) {
        if (!bindingTargetExists('process-type', targetId)) {
          return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Process type not found', 422, {
            targetKind: 'process-type',
            targetId,
          });
        }
      }
      for (const targetId of body.bindings.projectTypeIds) {
        if (!bindingTargetExists('project-type', targetId)) {
          return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Project type not found', 422, {
            targetKind: 'project-type',
            targetId,
          });
        }
      }
      for (const targetId of body.bindings.nodeKindIds) {
        if (!bindingTargetExists('node-kind', targetId)) {
          return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Node kind not found', 422, {
            targetKind: 'node-kind',
            targetId,
          });
        }
      }
      definition.bindings = body.bindings;
    }
    definition.updatedAt = new Date().toISOString();
    return HttpResponse.json(dto(definition));
  }),

  // Агрегат последствий удаления (Р8): окно показывает, что сотрётся.
  http.get('/api/v1/custom-fields/definitions/:id/usage', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const values = entitiesWithValue(definition.id);
    const usage: CustomFieldUsage = {
      values: {
        task: values.task.length,
        letter: values.letter.length,
        project: values.project.length,
        node: values.node.length,
      },
      forms: formsUsingField(definition.id),
      workflows: workflowsUsingField(definition.id),
      bindings: {
        processTypes: definition.bindings.processTypeIds
          .map((id) => mockTypes.find((type) => type.id === id))
          .filter((type): type is NonNullable<typeof type> => type !== undefined)
          .map((type) => ({ id: type.id, name: type.name })),
        projectTypes: definition.bindings.projectTypeIds
          .map((id) => demoProjectTypes.find((type) => type.id === id))
          .filter((type): type is NonNullable<typeof type> => type !== undefined)
          .map((type) => ({ id: type.id, name: type.name })),
        nodeKinds: definition.bindings.nodeKindIds
          .map((id) => demoNodeKinds.find((kind) => kind.id === id))
          .filter((kind): kind is NonNullable<typeof kind> => kind !== undefined)
          .map((kind) => ({ id: kind.id, name: kind.name })),
      },
      companyValue: definition.isCompany && definition.companyValue !== null,
    };
    return HttpResponse.json(usage);
  }),

  // Удаление всегда разрешено (Р8): значения всех носителей стираются,
  // формы видов теряют слот, маршруты продолжают работать (толерантность).
  http.delete('/api/v1/custom-fields/definitions/:id', ({ params }) => {
    const definition = demoFieldById(String(params.id));
    if (!definition) return error(ErrorCode.NOT_FOUND, 'Field not found', 404);
    const values = entitiesWithValue(definition.id);
    for (const task of values.task) {
      const next = { ...task.customFields };
      delete next[definition.id];
      task.customFields = next;
    }
    for (const letter of values.letter) {
      const next = { ...letter.customFields };
      delete next[definition.id];
      letter.customFields = next;
    }
    for (const project of values.project) {
      const next = { ...project.customFields };
      delete next[definition.id];
      project.customFields = next;
    }
    for (const node of values.node) {
      const next = { ...node.customFields };
      delete next[definition.id];
      node.customFields = next;
    }
    for (const kind of demoNodeKinds) {
      kind.form = {
        ...kind.form,
        fields: kind.form.fields.filter((slot) => slot.fieldId !== definition.id),
      };
    }
    for (const type of demoProjectTypes) {
      if (!type.form) continue;
      type.form = {
        ...type.form,
        fields: type.form.fields.filter((slot) => slot.fieldId !== definition.id),
      };
    }
    demoCustomFieldDefinitions.splice(demoCustomFieldDefinitions.indexOf(definition), 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
