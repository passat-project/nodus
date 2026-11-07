import { http, HttpResponse } from 'msw';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  ReorderCustomFieldsBody,
} from '@nodus/contracts';
import {
  createCustomFieldBodySchema,
  CUSTOM_FIELD_LIMITS,
  ErrorCode,
  reorderCustomFieldsBodySchema,
} from '@nodus/contracts';

import { dictionaryById, dictionaryIds, itemById } from '../../mocks/data/dictionaries.js';
import {
  demoCustomFieldDefinitions,
  demoFieldById,
  nextFieldNumber,
} from '../../mocks/data/custom-fields.js';
import {
  bindingTargetState,
  canManageFields,
  dto,
  error,
  forbidden,
  nameTaken,
  typeCategorySets,
} from './custom-fields-mock-utils.js';

/** Хендлеры коллекции реестра атрибутов (#631): список с фильтром модуля,
 *  создание (уникальность имени 409 с suggestion, потолок 1000, цели
 *  привязок) и порядок. Общий каркас мок-сервера — custom-fields-handlers.ts
 *  (порядок массивов: буквальные пути раньше `:id`, gotcha msw-query). */
export const registryHandlers = [
  http.get('/api/v1/custom-fields/definitions', ({ request }) => {
    const url = new URL(request.url);
    const module = url.searchParams.get('module');
    // Неизвестный модуль — 400, как у серверной схемы (не «весь реестр»).
    if (module !== null && !['company', 'task', 'letter', 'project', 'node'].includes(module)) {
      return error(ErrorCode.VALIDATION_FAILED, 'Unknown module', 400);
    }
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
    if (!canManageFields()) return forbidden();
    const parsed = createCustomFieldBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 400, parsed.error.issues);
    }
    const body: CreateCustomFieldBody = parsed.data;
    if (body.settings.dictionaryId && !dictionaryById(body.settings.dictionaryId)) {
      return error(ErrorCode.VALIDATION_FAILED, 'Dictionary not found', 400);
    }
    if (body.settings.currencyId) {
      const currency = itemById(body.settings.currencyId);
      if (!currency || !currency.isActive || currency.dictionaryId !== dictionaryIds.currency) {
        return error(ErrorCode.VALIDATION_FAILED, 'Currency not found', 400);
      }
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
    const targetError = (kind: 'process-type' | 'project-type' | 'node-kind', targetId: string) => {
      const state = bindingTargetState(kind, targetId);
      if (state === 'missing') {
        return error(ErrorCode.NOT_FOUND, 'Binding target not found', 404, {
          targetKind: kind,
          targetId,
        });
      }
      if (state === 'archived') {
        return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Target is archived', 422, {
          targetKind: kind,
          targetId,
        });
      }
      return null;
    };
    for (const targetId of bindings.processTypeIds) {
      const failure = targetError('process-type', targetId);
      if (failure) return failure;
    }
    for (const targetId of bindings.projectTypeIds) {
      const failure = targetError('project-type', targetId);
      if (failure) return failure;
    }
    for (const targetId of bindings.nodeKindIds) {
      const failure = targetError('node-kind', targetId);
      if (failure) return failure;
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
      bindingFormulas: body.bindingFormulas ?? {},
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    demoCustomFieldDefinitions.push(definition);
    return HttpResponse.json(dto(definition), { status: 201 });
  }),

  // Порядок — ДО '/definitions/:id' (gotcha msw-query: буквальный путь раньше).
  http.put('/api/v1/custom-fields/definitions/order', async ({ request }) => {
    if (!canManageFields()) return forbidden();
    const parsed = reorderCustomFieldsBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 400, parsed.error.issues);
    }
    const body: ReorderCustomFieldsBody = parsed.data;
    const ids = new Set(demoCustomFieldDefinitions.map((entry) => entry.id));
    if (
      body.ids.length !== ids.size ||
      new Set(body.ids).size !== body.ids.length ||
      body.ids.some((id) => !ids.has(id))
    ) {
      return error(ErrorCode.CONFLICT, 'Order is stale', 409);
    }
    body.ids.forEach((id, index) => {
      const definition = demoFieldById(id);
      if (definition) definition.sortOrder = index;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
