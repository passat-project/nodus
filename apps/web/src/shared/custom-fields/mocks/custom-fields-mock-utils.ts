import { HttpResponse } from 'msw';
import type { CustomFieldDefinition, CustomFieldValues } from '@nodus/contracts';
import { ErrorCode, Permission } from '@nodus/contracts';
import { customFieldKey, customFieldValueSchemaOf } from '@nodus/contracts';

import { getMockActor } from '../../mocks/mock-actor.js';

import { dictionaryById } from '../../mocks/data/dictionaries.js';
import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { demoRefsForValues } from '../../mocks/data/custom-fields-refs.js';
import { demoLetters } from '../../mocks/data/letters.js';
import { demoNodeKinds, demoNodeRows } from '../../mocks/data/project-nodes.js';
import { demoProjectRows, demoProjectTypes } from '../../mocks/data/projects.js';
import { demoSubtasks, demoTasks } from '../../mocks/data/tasks.js';
import { creationFormOf, mockTypes } from '../../mocks/data/process-types-store.js';
import { mockWorkflows } from '../../mocks/data/workflows-store.js';

/** Утилиты мок-сервера реестра атрибутов (#631): сборка DTO с гидратацией
 *  справочника/ссылок, ошибки, поиск дубля имени, категории типов, проверка
 *  целей привязки и подсчёт носителей значения. Общие для хендлеров
 *  коллекции (`custom-fields-registry-handlers.ts`) и одного атрибута
 *  (`custom-fields-definition-handlers.ts`). */

function dto(definition: CustomFieldDefinition): CustomFieldDefinition {
  // Справочник в DTO — только у списков (enum/multienum): у денег валюта
  // живёт в settings.currencyId, сервер dictionary не отдаёт.
  const dictionary =
    (definition.type === 'enum' || definition.type === 'multienum') &&
    definition.settings.dictionaryId
      ? dictionaryById(definition.settings.dictionaryId)
      : undefined;
  const defaultRefs =
    definition.defaultValue?.kind === 'static'
      ? demoRefsForValues({ [definition.id]: definition.defaultValue.value })
      : [];
  // Имена ссылок глобального значения (#646): сервер гидрирует глазами
  // актёра; мок-мир — теми же демо-справочниками.
  const companyRefs =
    definition.isCompany &&
    definition.companyValue !== null &&
    definition.companyValue !== undefined
      ? demoRefsForValues({ [definition.id]: definition.companyValue })
      : [];
  // Категории процессов (#632, Р9): решающий сигнал для атрибутных колонок
  // видов; сервер считает то же по привязкам типов.
  const categories = new Set<'task' | 'letter'>();
  for (const type of mockTypes) {
    if (type.archivedAt === null && definition.bindings.processTypeIds.includes(type.id)) {
      categories.add(type.category);
    }
  }
  return {
    ...definition,
    processCategories: [...categories],
    defaultRefs,
    companyRefs,
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

/** Право реестра атрибутов (#631, Р15): мок отвечает 403 так же, как сервер. */
export function canManageFields(): boolean {
  return getMockActor().permissions.includes(Permission.CUSTOM_FIELD_MANAGE);
}

/** 403 мок-мира (общий формат доменной ошибки). */
export function forbidden(): ReturnType<typeof error> {
  return error(ErrorCode.FORBIDDEN, 'Forbidden', 403);
}

function nameTaken(name: string, exceptId?: string) {
  const key = name.trim().toLowerCase();
  return demoCustomFieldDefinitions.find(
    (entry) => entry.id !== exceptId && entry.name.trim().toLowerCase() === key,
  );
}

/** Категории демо-типов процессов (для фильтра module=task|letter). */
function typeCategorySets() {
  // Сервер считает module=task|letter только по ЖИВЫМ типам (typeRefs live):
  // архивный тип не делает атрибут «задачным» (#646).
  const taskTypeIds = new Set(
    mockTypes
      .filter((type) => type.category === 'task' && type.archivedAt === null)
      .map((type) => type.id),
  );
  const letterTypeIds = new Set(
    mockTypes
      .filter((type) => type.category === 'letter' && type.archivedAt === null)
      .map((type) => type.id),
  );
  return { taskTypeIds, letterTypeIds };
}

/** Статические умолчания привязанных атрибутов — как `prepareCreate`
 *  сервера (author_department в мок-мире не поддержан: нужен отдел актёра). */
export function withStaticDefaults(
  definitions: readonly CustomFieldDefinition[],
  values: CustomFieldValues,
): CustomFieldValues {
  const next = { ...values };
  for (const definition of definitions) {
    if (next[definition.id] !== undefined) continue;
    if (definition.defaultValue?.kind === 'static') {
      next[definition.id] = definition.defaultValue.value;
    }
  }
  return next;
}

/** Грамматика значений без ссылочных проверок (мок-мир): сервер проверяет
 *  ещё существование/видимость целей. Возвращает проблемные fieldId. */
export function invalidMockValues(
  definitions: readonly CustomFieldDefinition[],
  values: CustomFieldValues,
): string[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return Object.entries(values)
    .filter(([fieldId, value]) => {
      const definition = byId.get(fieldId);
      return (
        definition !== undefined &&
        value !== null &&
        !customFieldValueSchemaOf(definition).safeParse(value).success
      );
    })
    .map(([fieldId]) => fieldId);
}

export type BindingTargetState = 'live' | 'archived' | 'missing';

/** Состояние цели привязки: сервер различает «нет цели» (404) и «архивная
 *  цель» (422); типы проектов/виды папок архивные допустимы. */
export function bindingTargetState(kind: string, targetId: string): BindingTargetState {
  switch (kind) {
    case 'process-type': {
      const type = mockTypes.find((entry) => entry.id === targetId);
      if (!type) return 'missing';
      return type.archivedAt === null ? 'live' : 'archived';
    }
    case 'project-type':
      return demoProjectTypes.some((type) => type.id === targetId) ? 'live' : 'missing';
    case 'node-kind':
      return demoNodeKinds.some((entry) => entry.id === targetId) ? 'live' : 'missing';
    default:
      return 'missing';
  }
}

function bindingTargetExists(kind: string, targetId: string): boolean {
  return bindingTargetState(kind, targetId) !== 'missing';
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

/** Формы, где атрибут стоит слотом (Р8/Р10): формы создания процессов
 *  (включая непубликуемые черновики), формы типов проектов и видов папок. */
function formsUsingField(fieldId: string) {
  const key = customFieldKey(fieldId);
  const processForms = mockTypes
    .filter((type) => creationFormOf(type).fields.some((slot) => slot.key === key) === true)
    .map((type) => ({
      kind: type.category as 'task' | 'letter',
      name: type.name,
      draft: mockWorkflows.get(type.workflowId)?.publishedAt == null,
    }));
  const projectForms = demoProjectTypes
    .filter((type) => type.form.fields.some((slot) => slot.fieldId === fieldId))
    .map((type) => ({ kind: 'project_type' as const, name: type.name, draft: false }));
  const nodeForms = demoNodeKinds
    .filter((kind) => kind.form.fields.some((slot) => slot.fieldId === fieldId))
    .map((kind) => ({ kind: 'node_kind' as const, name: kind.name, draft: false }));
  return [...processForms, ...projectForms, ...nodeForms];
}

export {
  bindingTargetExists,
  dto,
  entitiesWithValue,
  error,
  formsUsingField,
  nameTaken,
  typeCategorySets,
};

/** Снять слот атрибута из формы места в мок-мире (#646): unbind чистит
 *  форму так же, как сервер — инвариант «слот = привязка» в обе стороны. */
export function removeFormSlot(kind: string, targetId: string, fieldId: string): void {
  if (kind === 'project-type') {
    const type = demoProjectTypes.find((entry) => entry.id === targetId);
    if (type) {
      type.form = {
        ...type.form,
        fields: type.form.fields.filter((slot) => slot.fieldId !== fieldId),
      };
    }
    return;
  }
  if (kind === 'node-kind') {
    const nodeKind = demoNodeKinds.find((entry) => entry.id === targetId);
    if (nodeKind) {
      nodeKind.form = {
        ...nodeKind.form,
        fields: nodeKind.form.fields.filter((slot) => slot.fieldId !== fieldId),
      };
    }
  }
}

/** Полный набор привязок PATCH: неизвестная цель — 404, архивный тип
 *  процесса допустим только если уже привязан (#646). */
export function validateBindingTargets(
  definition: CustomFieldDefinition,
  bindings: {
    processTypeIds: readonly string[];
    projectTypeIds: readonly string[];
    nodeKindIds: readonly string[];
  },
): Response | null {
  const check = (
    kind: 'process-type' | 'project-type' | 'node-kind',
    ids: readonly string[],
    allowArchived: ReadonlySet<string>,
  ) => {
    for (const targetId of ids) {
      const state = bindingTargetState(kind, targetId);
      if (state === 'missing') {
        return error(ErrorCode.NOT_FOUND, 'Binding target not found', 404, {
          targetKind: kind,
          targetId,
        });
      }
      if (state === 'archived' && !allowArchived.has(targetId)) {
        return error(ErrorCode.CUSTOM_FIELD_BINDING_INVALID, 'Target is archived', 422, {
          targetKind: kind,
          targetId,
        });
      }
    }
    return null;
  };
  return (
    check('process-type', bindings.processTypeIds, new Set(definition.bindings.processTypeIds)) ??
    check('project-type', bindings.projectTypeIds, new Set()) ??
    check('node-kind', bindings.nodeKindIds, new Set())
  );
}
