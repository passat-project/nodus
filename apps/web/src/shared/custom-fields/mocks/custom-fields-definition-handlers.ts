import { http, HttpResponse } from 'msw';
import type { CustomFieldUsage, UpdateCustomFieldBody } from '@nodus/contracts';
import {
  customFieldCompanyValueBodySchema,
  customFieldValueSchemaOf,
  ErrorCode,
  isCompatibleTypeChange,
  updateCustomFieldBodySchema,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions, demoFieldById } from '../../mocks/data/custom-fields.js';
import { demoNodeKinds } from '../../mocks/data/project-nodes.js';
import { demoProjectTypes } from '../../mocks/data/projects.js';
import { mockTypes } from '../../mocks/data/process-types-store.js';
import { workflowsUsingField } from '../../mocks/data/workflows-store.js';
import {
  bindingTargetExists,
  dto,
  entitiesWithValue,
  error,
  formsUsingField,
  nameTaken,
} from './custom-fields-mock-utils.js';

/** Хендлеры одного атрибута реестра (#631): точечные привязки
 *  (идемпотентны, снятие всегда разрешено), значение глобальной
 *  переменной, правка (белый список смены типа, имя уникально), агрегат
 *  последствий usage и удаление (всегда разрешено, значения и формы
 *  чистятся). Общий каркас — custom-fields-handlers.ts; утилиты —
 *  custom-fields-mock-utils.ts. */
export const definitionHandlers = [
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
        // Значения контрагентов мок-мир не заводит (пути записи — Н2 CRM),
        // но контракт usage требует честный счётчик (#646).
        counterparty: 0,
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
