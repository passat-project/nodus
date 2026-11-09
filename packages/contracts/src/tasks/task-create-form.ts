import type { CustomFieldValue } from '../custom-fields/custom-field-values.js';
import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import type { CreateTaskBody, TaskPriority } from './task.schemas.js';
import {
  creationSlots,
  isCreationValueFilled,
  type CreationFieldKey,
  type CreationForm,
  type TaskCreationSystemKey,
} from '../workflows/creation-form.js';

/**
 * Форма создания ↔ тело `POST /tasks` (#432): ОДНА грамматика для окна
 * веба, моков и сервера. Скрытые значения формы важнее введённого
 * (`applyCreationPresets`), обязательность проверяется после скрытых
 * значений и умолчаний (`missingCreateFields`), очистку обязательного в
 * карточке ловит `clearedRequiredKeys`.
 */

/** Значение слота из тела создания (`cf.<id>` ↔ `customFields[id]`). */
export function createBodyValue(key: CreationFieldKey, body: CreateTaskBody): unknown {
  const fieldId = customFieldIdOfKey(key);
  if (fieldId !== null) return body.customFields?.[fieldId];
  switch (key as TaskCreationSystemKey) {
    case 'description':
      return body.description;
    case 'assignee':
      return body.assigneeId;
    case 'coexecutors':
      return body.coexecutorIds;
    case 'observers':
      return body.observerIds;
    case 'deadline':
      return body.deadline;
    case 'priority':
      return body.priority;
    case 'project':
      return body.projectId;
  }
}

/** Копия тела с установленным значением слота (неизменяемая). */
export function withCreateBodyValue(
  body: CreateTaskBody,
  key: CreationFieldKey,
  value: unknown,
): CreateTaskBody {
  if (value === null || value === undefined) return body;
  const fieldId = customFieldIdOfKey(key);
  if (fieldId !== null) {
    return {
      ...body,
      customFields: { ...(body.customFields ?? {}), [fieldId]: value as CustomFieldValue },
    };
  }
  switch (key as TaskCreationSystemKey) {
    case 'description':
      return { ...body, description: value as string };
    case 'assignee':
      return { ...body, assigneeId: value as string };
    case 'coexecutors':
      return { ...body, coexecutorIds: value as string[] };
    case 'observers':
      return { ...body, observerIds: value as string[] };
    case 'deadline':
      return { ...body, deadline: value as string };
    case 'priority':
      return { ...body, priority: value as TaskPriority };
    case 'project':
      return { ...body, projectId: value as string };
  }
}

/** Скрытые значения формы ставятся поверх введённого: значение формы важнее
 *  (Р4) — на всех путях создания, включая API и будущего ИИ-агента. */
export function applyCreationPresets(form: CreationForm, body: CreateTaskBody): CreateTaskBody {
  return creationSlots(form)
    .filter((slot) => slot.preset !== null)
    .reduce((acc, slot) => withCreateBodyValue(acc, slot.key, slot.preset), body);
}

/** «Заполнено» ли значение слота (общая грамматика с окном). */
export function isCreateValueFilled(key: CreationFieldKey, value: unknown): boolean {
  return isCreationValueFilled(key, value);
}

/** Обязательные при создании ключи формы (без скрытых: их ставит сервер). */
export function requiredCreateKeys(form: CreationForm): CreationFieldKey[] {
  return creationSlots(form)
    .filter((slot) => slot.required && slot.preset === null)
    .map((slot) => slot.key);
}

/** Чего не хватает для создания (Р5): проверка ПОСЛЕ скрытых значений и
 *  умолчаний — ключи, которые сервер заполнит сам (`defaultsFilled`), не
 *  считаются пропущенными. */
export function missingCreateFields(
  form: CreationForm,
  body: CreateTaskBody,
  opts: { defaultsFilled?: ReadonlySet<string> } = {},
): CreationFieldKey[] {
  return requiredCreateKeys(form).filter(
    (key) =>
      !opts.defaultsFilled?.has(key) && !isCreationValueFilled(key, createBodyValue(key, body)),
  );
}

/** Ключи обязательных полей, которые патч очищает (`null`/пусто) — 422
 *  `PROCESS_TYPE_FIELDS_REQUIRED { reason: 'clear' }` (Р5). `values` — новые
 *  значения по ключам слотов; отсутствующий ключ не трогается. */
export function clearedRequiredKeys(
  requiredKeys: readonly CreationFieldKey[],
  values: Readonly<Record<string, unknown>>,
): CreationFieldKey[] {
  return requiredKeys.filter((key) => key in values && !isCreationValueFilled(key, values[key]));
}
