import { z } from 'zod';

import type { CustomFieldDefinition } from '../custom-fields/custom-field.schemas.js';
import { customFieldIdOfKey, customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { formulaNodeSchema } from '../custom-fields/formula.js';
import {
  customFieldValueSchemaOf,
  isCustomFieldValueFilled,
  moneyValueSchema,
} from '../custom-fields/custom-field-values.js';
import { ui } from '../i18n/ru.js';
import type { ProcessCategory } from './process-type.schemas.js';
import type { WorkflowProblem } from './workflow-document.schemas.js';

/**
 * Форма создания — окно узла «Создание» документа маршрута (#432, ADR-0024
 * п.5): упорядоченный список слотов, публикуется версиями вместе с
 * маршрутом. Общая грамматика (исключение patterns.md): редактор веба, моки
 * и сервер обязаны видеть одни и те же правила — `checkCreationForm`
 * возвращает те же коды проблем, что показывает чип публикации.
 *
 * Слот: `{ key, label, required, preset }`. `preset ≠ null` — поле скрыто и
 * заполняется сервером на всех путях создания; своё название слота (В3)
 * переименовывает поле ТОЛЬКО в окне, атрибут в карточке не меняется.
 */

/** Чипы-блоки под полями окна (реестр закрыт: расширение — новый вид блока). */
export const creationChipSchema = z.enum(['checklist', 'planned']);
export type CreationChip = z.infer<typeof creationChipSchema>;

/** Системные поля задачи, которые можно вынести в окно создания. */
export const taskCreationSystemKeySchema = z.enum([
  'description',
  'assignee',
  'coexecutors',
  'observers',
  'deadline',
  'priority',
  'project',
]);
export type TaskCreationSystemKey = z.infer<typeof taskCreationSystemKeySchema>;

/** Системные ключи в порядке выбора (группа «Системные» в редакторе формы). */
export const TASK_CREATION_SYSTEM_KEYS = taskCreationSystemKeySchema.options;

/** Ключ слота: системное поле задачи или атрибут `cf.<uuid>`. Union —
 *  надмножество: формы писем (#55) расширят системные ключи. */
export const creationFieldKeySchema = z.union([taskCreationSystemKeySchema, customFieldKeySchema]);
export type CreationFieldKey = z.infer<typeof creationFieldKeySchema>;

/** Скрытое значение (пресет): текст, список, число, флаг или деньги. Тип
 *  конкретного поля проверяет `checkCreationForm` (одна грамматика). */
export const creationPresetSchema = z.union([
  z.string().max(5000),
  z.array(z.string()).max(50),
  z.number(),
  z.boolean(),
  moneyValueSchema,
]);
export type CreationPreset = z.infer<typeof creationPresetSchema>;

export const creationFieldSlotSchema = z
  .object({
    key: creationFieldKeySchema,
    /** Своё название поля в форме (В3); null — стандартное или роль. */
    label: z.string().trim().min(1).max(60).nullable(),
    /** Обязательно при создании: без значения «Создать» неактивна, сервер — 422. */
    required: z.boolean(),
    /** Скрытое поле с предустановленным значением; null — поле видно. */
    preset: creationPresetSchema.nullable(),
    /** Формула-подстановка (#632, Р12): значение считается при открытии окна,
     *  человек может поправить; в тело создания едет значением. */
    formula: formulaNodeSchema.nullable().optional(),
  })
  .strict();
export type CreationFieldSlot = z.infer<typeof creationFieldSlotSchema>;

export const creationFormSchema = z
  .object({
    fields: z.array(creationFieldSlotSchema).max(30),
    chips: z.array(creationChipSchema).max(5),
  })
  .strict();
export type CreationForm = z.infer<typeof creationFormSchema>;

/** Лимиты формы — подсказки редактора берут числа отсюда. */
export const CREATION_FORM_LIMITS = {
  fields: 30,
  chips: 5,
  label: 60,
  presetText: 5000,
  presetList: 50,
} as const;

/** Форма по умолчанию — нынешняя экспресс-форма задачи (Р2): описание,
 *  ответственный, срок, проект + чипы «Чек-лист» и «Планируемое время». */
export function defaultCreationForm(category: ProcessCategory): CreationForm {
  if (category === 'task') {
    return {
      fields: ['description', 'assignee', 'deadline', 'project'].map((key) => ({
        key: key as CreationFieldKey,
        label: null,
        required: false,
        preset: null,
      })),
      chips: ['checklist', 'planned'],
    };
  }
  return { fields: [], chips: [] };
}

/** Эффективная форма: опубликованная или форма по умолчанию. Битая
 *  читается толерантно — как умолчание (не ошибка экрана, Р2). */
export function effectiveCreationForm(raw: unknown, category: ProcessCategory): CreationForm {
  if (raw === null || raw === undefined) return defaultCreationForm(category);
  const parsed = creationFormSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultCreationForm(category);
}

/** «Обязательно» доступно всем, кроме ответственного и приоритета: у них
 *  всегда есть значение (Р2). */
export function requiredAllowed(key: CreationFieldKey): boolean {
  return key !== 'assignee' && key !== 'priority';
}

/** Скрытое значение: недоступно сроку (абсолютная дата бессмысленна, Р2);
 *  относительный срок «+N дней» — вместе с #436. */
export function presetAllowed(key: CreationFieldKey): boolean {
  return key !== 'deadline';
}

/** Роли, чьи названия переопределяются настройками типа (`config.card`). */
const ROLE_OF_KEY = {
  assignee: 'assignee',
  coexecutors: 'coexecutor',
  observers: 'observer',
} as const;

export interface SlotLabelContext {
  /** Названия ролей из «Настроек типа» (Р3): «Постановщик» → «Заявитель». */
  roleLabels?: Partial<Record<'creator' | 'assignee' | 'coexecutor' | 'observer', string | null>>;
  /** Определения области — имя атрибута для слота `cf.<id>`. */
  definitions?: readonly Pick<CustomFieldDefinition, 'id' | 'name'>[];
}

/** Подпись слота (Р3): своё название → название роли из типа → стандартное
 *  (i18n или имя атрибута). Атрибут в карточке форма не переименовывает. */
export function slotLabel(slot: CreationFieldSlot, ctx: SlotLabelContext = {}): string {
  if (slot.label !== null && slot.label.trim().length > 0) return slot.label;
  const role = ROLE_OF_KEY[slot.key as keyof typeof ROLE_OF_KEY];
  const roleLabel = role ? ctx.roleLabels?.[role] : null;
  if (roleLabel && roleLabel.trim().length > 0) return roleLabel;
  const fieldId = customFieldIdOfKey(slot.key);
  if (fieldId !== null) {
    return ctx.definitions?.find((d) => d.id === fieldId)?.name ?? ui.taskCreate.unknownField;
  }
  return ui.taskCreate.fields[slot.key as TaskCreationSystemKey];
}

/** Факты проверки формы: реестр атрибутов, привязка к типу, живые
 *  сотрудники и наличие модуля проектов (Р2, Р4, Р8). Глобального скрытия
 *  нет (О2 #631): «спрятать» = снять привязку или слот hidden у места. */
export interface CreationFormFacts {
  category: ProcessCategory;
  customFields: {
    /** id живых атрибутов. */
    active: ReadonlySet<string>;
    /** id атрибутов, привязанных к типу (Р8). */
    inType: ReadonlySet<string>;
  };
  /** Определения: тип и настройки значения для проверки пресета. */
  definitions?: readonly Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>[];
  /** Доступны ли проекты (модуль #52); по умолчанию — да. */
  projectsAvailable?: boolean;
  /** Живые сотрудники — пресеты ответственного, соисполнителей, наблюдателей. */
  activeUserIds?: ReadonlySet<string>;
}

function creationProblem(code: WorkflowProblem['code'], creationField: string): WorkflowProblem {
  return { code, severity: 'error', creationField };
}

/** Годится ли пресет полю по типу значения (Р2, Р4). */
function presetFits(
  key: CreationFieldKey,
  preset: CreationPreset,
  facts: CreationFormFacts,
): boolean {
  if (key === 'description') return typeof preset === 'string';
  if (key === 'priority') {
    return typeof preset === 'string' && ['low', 'normal', 'high', 'urgent'].includes(preset);
  }
  if (key === 'project') return typeof preset === 'string' && z.uuid().safeParse(preset).success;
  if (key === 'assignee') {
    if (typeof preset !== 'string' || !z.uuid().safeParse(preset).success) return false;
    return facts.activeUserIds ? facts.activeUserIds.has(preset) : true;
  }
  if (key === 'coexecutors' || key === 'observers') {
    if (!Array.isArray(preset)) return false;
    if (preset.length === 0 || preset.length > CREATION_FORM_LIMITS.presetList) return false;
    if (preset.some((id) => !z.uuid().safeParse(id).success)) return false;
    if (new Set(preset).size !== preset.length) return false;
    return facts.activeUserIds ? preset.every((id) => facts.activeUserIds!.has(id)) : true;
  }
  const fieldId = customFieldIdOfKey(key);
  const definition = fieldId ? facts.definitions?.find((d) => d.id === fieldId) : undefined;
  if (!definition) return true;
  return customFieldValueSchemaOf(definition).safeParse(preset).success;
}

/**
 * Проверка формы создания: ошибки запрещают публикацию, предупреждений нет —
 * форма либо работает, либо публикация отклоняется с понятным перечнем.
 * Порядок детерминирован: слоты в порядке формы, правила в порядке кодов.
 */
export function checkCreationForm(form: CreationForm, facts: CreationFormFacts): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const seen = new Set<string>();

  for (const slot of form.fields) {
    const key = slot.key;
    if (seen.has(key)) problems.push(creationProblem('creation_duplicate_field', key));
    seen.add(key);

    const fieldId = customFieldIdOfKey(key);
    if (fieldId !== null) {
      if (!facts.customFields.active.has(fieldId)) {
        problems.push(creationProblem('custom_field_unknown', key));
        continue;
      }
      if (!facts.customFields.inType.has(fieldId)) {
        problems.push(creationProblem('custom_field_not_in_type', key));
      }
    } else if (key === 'project' && facts.projectsAvailable === false) {
      problems.push(creationProblem('creation_field_unavailable', key));
    }

    if (slot.preset !== null) {
      if (!presetAllowed(key)) {
        problems.push(creationProblem('creation_preset_not_allowed', key));
      } else if (slot.required) {
        problems.push(creationProblem('creation_hidden_required', key));
      } else if (!presetFits(key, slot.preset, facts)) {
        problems.push(creationProblem('creation_preset_invalid', key));
      }
    } else if (slot.required && !requiredAllowed(key)) {
      problems.push(creationProblem('creation_required_not_allowed', key));
    }
  }

  return problems;
}

/** «Заполнено» ли значение слота — общая грамматика с окном создания. */
export function isCreationValueFilled(key: CreationFieldKey, value: unknown): boolean {
  if (key === 'description') return typeof value === 'string' && value.trim().length > 0;
  if (key === 'coexecutors' || key === 'observers') {
    return Array.isArray(value) && value.length > 0;
  }
  if (customFieldIdOfKey(key) !== null) return isCustomFieldValueFilled(value);
  return value !== null && value !== undefined && value !== '';
}
