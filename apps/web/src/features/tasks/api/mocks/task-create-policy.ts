import type {
  CreateTaskBody,
  CreationFieldKey,
  CreationForm,
  CustomFieldValues,
} from '@nodus/contracts';
import {
  ErrorCode,
  applyCreationPresets,
  bindingsOf,
  clearedRequiredKeys,
  defaultCreationForm,
  isCreationValueFilled,
  missingCreateFields,
  requiredCreateKeys,
  typeAccessFor,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import {
  checkDemoValues,
  demoDefaults,
} from '../../../../shared/mocks/data/custom-fields-rules.js';
import { mockEffectiveRoleIds, mockIsAdmin } from '../../../../shared/mocks/data/roles.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { typeDto } from '../../../../shared/mocks/data/process-types-dto.js';
import {
  creationFormOf,
  mockTypes,
  type DemoProcessType,
} from '../../../../shared/mocks/data/process-types-store.js';

/**
 * Политика создания задачи в моке (#432, Р4–Р6, Р8) — зеркало серверной
 * `tasks/task-create.policy.ts`: доступ к типу, скрытые значения формы,
 * обязательность после умолчаний, значения непривязанных атрибутов и
 * недействительные пресеты. Мок обязан давать те же ответы, что API.
 */

export interface PolicyError {
  status: number;
  code: ErrorCode;
  details?: unknown;
}

export type PolicyResult<T> = { ok: true; value: T } | { ok: false; error: PolicyError };

const fail = (status: number, code: ErrorCode, details?: unknown): PolicyResult<never> => ({
  ok: false,
  error: { status, code, details },
});

/** Живые сотрудники — проверка пресетов «ответственный/соисполнители/наблюдатели». */
const activeUserIds = new Set(
  demoUserListItems.filter((user) => user.status === 'active').map((user) => user.id),
);

/** Тип создания: явный `typeId` или «Стандартный» (код `task`), как сервер. */
export function resolveCreateType(typeId: string | undefined): PolicyResult<DemoProcessType> {
  const type = typeId
    ? mockTypes.find((entry) => entry.id === typeId && entry.category === 'task')
    : mockTypes.find((entry) => entry.code === 'task');
  if (!type || type.archivedAt) return fail(404, ErrorCode.NOT_FOUND);
  const viewer = typeDto(type).viewer;
  if (!viewer.canCreate) {
    return fail(403, ErrorCode.PROCESS_TYPE_FORBIDDEN, {
      typeId: type.id,
      reason: viewer.canView ? 'not_creatable' : 'view',
    });
  }
  return { ok: true, value: type };
}

/** Атрибуты, привязанные к типу (Р8): только они видны и принимают значения.
 *  Привязка — к типу процесса (`bindings.processTypeIds`, «Где используется»). */
export function boundFieldIds(type: DemoProcessType): ReadonlySet<string> {
  return new Set(
    demoCustomFieldDefinitions
      .filter((entry) => bindingsOf(entry).processTypeIds.includes(type.id))
      .map((entry) => entry.id),
  );
}

/** Значения непривязанных атрибутов: запись — ошибка, очистка (`null`)
 *  разрешена всегда (Р8). */
function unboundIssues(
  type: DemoProcessType,
  values: CustomFieldValues | Record<string, unknown>,
): { fieldId: string; reason: string; message: string }[] {
  const bound = boundFieldIds(type);
  return Object.entries(values)
    .filter(([fieldId, value]) => value !== null && !bound.has(fieldId))
    .map(([fieldId]) => ({
      fieldId,
      reason: 'not_in_type',
      message: 'Field is not bound to the task type',
    }));
}

/** Пресет сотрудника/списка сотрудников должен ссылаться на живых (Р4). */
function invalidPresetKeys(form: CreationForm): string[] {
  const invalid: string[] = [];
  for (const slot of form.fields) {
    if (slot.preset === null) continue;
    const ids =
      slot.key === 'assignee'
        ? typeof slot.preset === 'string'
          ? [slot.preset]
          : []
        : slot.key === 'coexecutors' || slot.key === 'observers'
          ? Array.isArray(slot.preset)
            ? slot.preset
            : []
          : [];
    if (ids.some((id) => !activeUserIds.has(id))) invalid.push(slot.key);
  }
  return invalid;
}

/**
 * Тело создания после политики: пресеты формы важнее ввода, умолчания —
 * только привязанных атрибутов, обязательные поля проверяются последними.
 */
export function prepareCreateBody(
  type: DemoProcessType,
  input: CreateTaskBody,
): PolicyResult<CreateTaskBody> {
  const form = creationFormOf(type);
  const unbound = unboundIssues(type, input.customFields ?? {});
  if (unbound.length > 0) {
    return fail(422, ErrorCode.CUSTOM_FIELD_VALUE_INVALID, { issues: unbound });
  }
  const presetFields = invalidPresetKeys(form);
  if (presetFields.length > 0) {
    return fail(422, ErrorCode.PROCESS_TYPE_PRESET_INVALID, {
      typeId: type.id,
      fields: presetFields,
    });
  }

  let body = applyCreationPresets(form, input);
  // Умолчания — только атрибутов, привязанных к типу создаваемой задачи (Р8).
  body = {
    ...body,
    customFields: demoDefaults(body.customFields ?? {}, boundFieldIds(type)),
  };
  const fieldIssues = checkDemoValues(body.customFields ?? {}, boundFieldIds(type));
  if (fieldIssues.length > 0) {
    return fail(422, ErrorCode.CUSTOM_FIELD_VALUE_INVALID, { issues: fieldIssues });
  }

  // Ответственного сервер ставит сам (постановщик) — «не хватает» его не считает.
  const missing = missingCreateFields(form, body, { defaultsFilled: new Set(['assignee']) });
  if (missing.length > 0) {
    return fail(422, ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED, {
      typeId: type.id,
      fields: missing,
      reason: 'create',
    });
  }
  return { ok: true, value: body };
}

/** Обязательные ключи типа задачи (карточка: нельзя очистить). */
export function requiredKeysOf(type: DemoProcessType | undefined): CreationFieldKey[] {
  return type
    ? requiredCreateKeys(creationFormOf(type))
    : requiredCreateKeys(defaultCreationForm('task'));
}

/** Ключи слотов из патча карточки (для проверки «нельзя очистить», Р5). */
export function creationValuesOfPatch(patch: {
  description?: string;
  deadline?: string | null;
  assigneeId?: string;
  customFields?: Record<string, unknown>;
}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.deadline !== undefined) values.deadline = patch.deadline;
  if (patch.assigneeId !== undefined) values.assignee = patch.assigneeId;
  for (const [fieldId, value] of Object.entries(patch.customFields ?? {})) {
    values[`cf.${fieldId}`] = value;
  }
  return values;
}

/** Очистка обязательного при создании поля — 422 `reason: 'clear'` (Р5). */
export function checkClearedRequired(
  type: DemoProcessType | undefined,
  patch: Parameters<typeof creationValuesOfPatch>[0],
): PolicyResult<true> {
  const cleared = clearedRequiredKeys(requiredKeysOf(type), creationValuesOfPatch(patch));
  if (cleared.length > 0) {
    return fail(422, ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED, {
      typeId: type?.id,
      fields: cleared,
      reason: 'clear',
    });
  }
  return { ok: true, value: true };
}

/** Запись значения непривязанного к типу атрибута — 422 (`null` разрешён). */
export function checkUnboundValues(
  type: DemoProcessType | undefined,
  values: Record<string, unknown>,
): PolicyResult<true> {
  if (!type) return { ok: true, value: true };
  const issues = unboundIssues(type, values);
  if (issues.length > 0) return fail(422, ErrorCode.CUSTOM_FIELD_VALUE_INVALID, { issues });
  return { ok: true, value: true };
}

/** Тип задачи по id (карточка: обязательные поля, привязки). */
export function typeOfTask(typeId: string): DemoProcessType | undefined {
  return mockTypes.find((entry) => entry.id === typeId);
}

/** Значение слота заполнено — общий предикат (участники: последний обязательный). */
export { isCreationValueFilled };

/** Роль зрителя типа (для хендлеров смены типа и списков). */
export function viewerOf(type: DemoProcessType) {
  return typeAccessFor(
    { config: type.config, creatable: type.creatable },
    { roleIds: mockEffectiveRoleIds(getMockActor().id), isAdmin: mockIsAdmin(getMockActor().id) },
  );
}
