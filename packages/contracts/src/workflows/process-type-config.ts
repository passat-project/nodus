import { z } from 'zod';

import {
  creationFieldKeySchema,
  effectiveCreationForm,
  type CreationForm,
} from './creation-form.js';
import {
  customFieldBindingsSchema,
  EMPTY_CUSTOM_FIELD_BINDINGS,
  type CustomFieldBindings,
} from '../custom-fields/custom-field.schemas.js';

/**
 * Конфигурация типа процесса (#432, В6): состав карточки и доступ к типу.
 * Живёт в `process_types.config` (JSONB), сохраняется СРАЗУ — публикации
 * требует только маршрут (форма создания). Схема закрытая и явная: битый
 * раздел при чтении заменяется умолчанием (`normalizeTypeConfig`), запись —
 * только целыми разделами. Флага «Показывать в пульсе проекта» у типа нет
 * (вердикт владельца 26.10.2026): что видно в пульсе, решает проект (#469).
 */

/** Служебный код типа по умолчанию («Стандартный»): по нему создают быстрые
 *  входы, поэтому его доступ и создание заблокированы (Р6). */
export const DEFAULT_TASK_TYPE_CODE = 'task';

/** Блоки карточки задачи, которые тип может скрыть (Р7). Блок — это
 *  представление, а не права: состав карточки не ограничивает доступ. */
export const taskCardBlockSchema = z.enum([
  'description',
  'checklist',
  'subtasks',
  'time',
  'result',
  'relations',
  'chat',
]);
export type TaskCardBlock = z.infer<typeof taskCardBlockSchema>;

export const taskCardBlockOrder = taskCardBlockSchema.options;

/** Роли задачи, названия которых переопределяются типом (В3/Р3). */
export const taskRoleKeySchema = z.enum(['creator', 'assignee', 'coexecutor', 'observer']);
export type TaskRoleKey = z.infer<typeof taskRoleKeySchema>;

export const roleLabelsSchema = z
  .object({
    creator: z.string().trim().min(1).max(40).optional(),
    assignee: z.string().trim().min(1).max(40).optional(),
    coexecutor: z.string().trim().min(1).max(40).optional(),
    observer: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type RoleLabels = z.infer<typeof roleLabelsSchema>;

export const processTypeCardSchema = z
  .object({
    hiddenBlocks: z.array(taskCardBlockSchema).max(taskCardBlockOrder.length),
    roleLabels: roleLabelsSchema,
  })
  .strict();
export type ProcessTypeCard = z.infer<typeof processTypeCardSchema>;

/** Состав карточки конкретной задачи (`GET /tasks/:id` → `layout`): сервер
 *  собирает его сам из типа, поэтому он работает и для типа, невидимого
 *  зрителю (Р7). `requiredKeys` — обязательные при создании поля: их нельзя
 *  очистить в карточке. */
export const taskCardLayoutSchema = z
  .object({
    hiddenBlocks: z.array(taskCardBlockSchema).max(taskCardBlockOrder.length),
    roleLabels: roleLabelsSchema,
    requiredKeys: z.array(creationFieldKeySchema).max(30),
  })
  .strict();
export type TaskCardLayout = z.infer<typeof taskCardLayoutSchema>;

export const DEFAULT_TASK_CARD_LAYOUT: TaskCardLayout = {
  hiddenBlocks: [],
  roleLabels: {},
  requiredKeys: [],
};

/** Доступ к типу: `null` — все; массив — только перечисленные роли.
 *  Администратор видит и создаёт всегда (Р6). */
export const processTypeAccessSchema = z
  .object({
    view: z.array(z.uuid()).max(50).nullable(),
    create: z.array(z.uuid()).max(50).nullable(),
  })
  .strict();
export type ProcessTypeAccess = z.infer<typeof processTypeAccessSchema>;

/** Нумерация типа (#55, Р2): серия «Процессов», из которой пост-действие
 *  «Присвоить номер» выдаёт номер. Только у писем; правка серии в
 *  интерфейсе — #504 (сейчас каталог ставит серию по коду типа). */
export const processTypeNumberingConfigSchema = z.object({ seriesId: z.uuid() }).strict();
export type ProcessTypeNumberingConfig = z.infer<typeof processTypeNumberingConfigSchema>;

export const processTypeConfigSchema = z
  .object({
    card: processTypeCardSchema,
    access: processTypeAccessSchema,
    numbering: processTypeNumberingConfigSchema.optional(),
  })
  .strict();
export type ProcessTypeConfig = z.infer<typeof processTypeConfigSchema>;

/** `PATCH /workflows/types/:id/config` — разделы заменяются ЦЕЛИКОМ;
 *  отсутствующий раздел не трогается. Без `.default()` (gotcha Zod 4
 *  `.partial()`: умолчания подставляются в чужой раздел). */
export const updateProcessTypeConfigBodySchema = z
  .object({
    card: processTypeCardSchema.optional(),
    access: processTypeAccessSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type UpdateProcessTypeConfigBody = z.infer<typeof updateProcessTypeConfigBodySchema>;

/** Что видит и может текущий пользователь (сервер — истина, I8; веб прячет
 *  недоступное). Считает `typeAccessFor`. */
export const processTypeViewerSchema = z.object({
  canView: z.boolean(),
  canCreate: z.boolean(),
});
export type ProcessTypeViewer = z.infer<typeof processTypeViewerSchema>;

/** Умолчания конфигурации: карточка полная, доступ всем. */
export const DEFAULT_PROCESS_TYPE_CONFIG: ProcessTypeConfig = {
  card: { hiddenBlocks: [], roleLabels: {} },
  access: { view: null, create: null },
};

function parseOr<T>(schema: z.ZodType<T>, raw: unknown, fallback: T): T {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/** Толерантное чтение `process_types.config` (`{}` → умолчания, битый
 *  раздел → умолчание раздела; остальные разделы не страдают; лишние
 *  ключи отбрасываются). Нумерация (#55) — только валидная: битая или
 *  отсутствующая не попадает в результат (тип «без серии»). */
export function normalizeTypeConfig(raw: unknown): ProcessTypeConfig {
  if (raw === null || typeof raw !== 'object') return DEFAULT_PROCESS_TYPE_CONFIG;
  const source = raw as Record<string, unknown>;
  const numbering = processTypeNumberingConfigSchema.safeParse(source.numbering);
  return {
    card: parseOr(processTypeCardSchema, source.card, DEFAULT_PROCESS_TYPE_CONFIG.card),
    access: parseOr(processTypeAccessSchema, source.access, DEFAULT_PROCESS_TYPE_CONFIG.access),
    ...(numbering.success ? { numbering: numbering.data } : {}),
  };
}

/** «Стандартный» — тип по умолчанию: быстрые входы создают по нему, поэтому
 *  списки доступа и флаг создания у него заблокированы (Р6/О8). */
export function isDefaultProcessType(type: { code: string }): boolean {
  return type.code === DEFAULT_TASK_TYPE_CODE;
}

/** Код роли администратора в справочнике ролей (#379). */
export const ADMIN_ROLE_CODE = 'admin';

export interface TypeAccessInput {
  config: ProcessTypeConfig;
  creatable: boolean;
}

export interface TypeAccessSubject {
  /** Роли пользователя (эффективные, включая роли подразделений). */
  roleIds: readonly string[];
  /** Среди эффективных ролей есть «Администратор». */
  isAdmin: boolean;
}

/**
 * Доступ к типу (Р6), одна функция для веба, моков и сервера:
 * администратор — всё; `canView` = «всем» или общая роль; `canCreate` =
 * видит И `creatable` И («всем» или общая роль). `creatable=false` означает
 * «создают никто, кроме администратора».
 */
export function typeAccessFor(
  type: TypeAccessInput,
  subject: TypeAccessSubject,
): ProcessTypeViewer {
  if (subject.isAdmin) return { canView: true, canCreate: true };
  const shared = (allowed: readonly string[] | null): boolean =>
    allowed === null || allowed.some((roleId) => subject.roleIds.includes(roleId));
  const canView = shared(type.config.access.view);
  return { canView, canCreate: canView && type.creatable && shared(type.config.access.create) };
}

/** Тип виден зрителю — фильтр списков типов и каталога стадий (Р6). */
export function isTypeVisible(type: TypeAccessInput, subject: TypeAccessSubject): boolean {
  return typeAccessFor(type, subject).canView;
}

/**
 * Терпимое чтение DTO со старого API (:5173 без бэкенд-пакета #432):
 * `config`, `creationForm`, `viewer`, `layout`, `typeIds` приходят позже —
 * веб живёт на умолчаниях, а не падает. Одна точка на весь фронт
 * (риски плана §11: «:5173 со старым API»).
 */

export function typeConfigOf(type: { config?: unknown }): ProcessTypeConfig {
  return normalizeTypeConfig(type.config);
}

export function typeCreationFormOf(type: {
  creationForm?: unknown;
  category: 'task' | 'letter';
}): CreationForm {
  return effectiveCreationForm(type.creationForm, type.category);
}

export function typeViewerOf(type: {
  viewer?: ProcessTypeViewer;
  creatable: boolean;
}): ProcessTypeViewer {
  return type.viewer ?? { canView: true, canCreate: type.creatable };
}

/** Привязки атрибута к местам; старый API поля не отдаёт — пусто. */
export function bindingsOf(definition: {
  bindings?: CustomFieldBindings | unknown;
}): CustomFieldBindings {
  const parsed = customFieldBindingsSchema.safeParse(definition.bindings);
  return parsed.success ? parsed.data : EMPTY_CUSTOM_FIELD_BINDINGS;
}

/** Состав карточки задачи; старый API `layout` не отдаёт — карточка полная. */
export function taskLayoutOf(task: { layout?: unknown }): TaskCardLayout {
  const parsed = taskCardLayoutSchema.safeParse(task.layout);
  return parsed.success ? parsed.data : DEFAULT_TASK_CARD_LAYOUT;
}
