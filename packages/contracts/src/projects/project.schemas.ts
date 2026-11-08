import { z } from 'zod';

import { counterpartyRefSchema } from '../counterparties/counterparty.schemas.js';
import { customFieldRefSchema } from '../custom-fields/custom-field-refs.js';
import {
  customFieldValuesInputSchema,
  customFieldValuesPatchSchema,
  customFieldValuesSchema,
  isCustomFieldValueFilled,
  type CustomFieldValues,
} from '../custom-fields/custom-field-values.js';
import {
  fieldFormSlotSchema,
  formSlots,
  isFieldFormSlot,
  type FieldFormSlot,
} from '../custom-fields/field-form.schemas.js';
import { customFieldFormulasSchema } from '../custom-fields/formula-api.schemas.js';
import { refineAttributeElements } from '../forms/attribute-form.js';
import {
  FORM_LAYOUT_LIMITS,
  formDecorSchema,
  formHeightSchema,
  formWidthSchema,
  type FormDecor,
} from '../forms/form-layout.js';
import { userRefSchema } from '../directory/user-ref.schema.js';
import { processTypeIconSchema } from '../workflows/process-type.schemas.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';

/**
 * Контракты модуля проектов (#52, ADR-0030): проект = договор (шифр) или
 * «тема» (без шифра); участие двухрежимное (открытый — динамика из задач,
 * секретный — ручной состав), руководство — системные поля
 * Руководитель + Помощники (вердикты владельца 29.10).
 */

/** Видимость: открытый виден всем, секретный — только участию (+ view_secret). */
export const projectVisibilitySchema = z.enum(['open', 'secret']);
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;

/** Действует / завершён (метка) / в архиве (заморозка: создание задач — 422). */
export const projectStatusSchema = z.enum(['active', 'completed', 'archived']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Цвет-идентичность проекта (маркер-плитка в журналах и ссылках). Ключи,
 *  не hex (I15): тон разрешается в categorical-токены --chart-* своей темы. */
export const projectColorSchema = z.enum(['blue', 'green', 'amber', 'pink', 'sky', 'terra']);
export type ProjectColor = z.infer<typeof projectColorSchema>;

/** Источник участия (Р2 техплана #52): руководство, динамика задач,
 *  ручное добавление (секретный), вступление/приглашение наблюдателем. */
export const projectParticipantSourceSchema = z.enum([
  'manager',
  'assistant',
  'task',
  'member',
  'observer',
]);
export type ProjectParticipantSource = z.infer<typeof projectParticipantSourceSchema>;

/** Ручное участие в секретном проекте: участник (может получать задачи) /
 *  наблюдатель (только просмотр). */
export const projectMembershipKindSchema = z.enum(['member', 'observer']);
export type ProjectMembershipKind = z.infer<typeof projectMembershipKindSchema>;

/** Откуда наблюдатель: приглашён руководством / создатель-не-руководитель /
 *  вступил сам («Присоединиться», открытый проект). */
export const projectObserverKindSchema = z.enum(['invited', 'creator', 'joined']);
export type ProjectObserverKind = z.infer<typeof projectObserverKindSchema>;

/** Ссылка на проект (задачи, письма, канал). Код nullable — «темы» без шифра. */
export const projectRefSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1).nullable(),
  name: z.string().min(1),
  color: projectColorSchema,
});

export type ProjectRef = z.infer<typeof projectRefSchema>;

/** Форма типа проекта (Р10 #631): слоты атрибутов в состояниях
 *  «скрыто / по желанию / обязательно» — зеркало формы вида папки. Посевной
 *  слот «Шифр» занимает место бывшей политики codeField. */
export const PROJECT_TYPE_LIMITS = {
  /** Атрибутов в форме типа (слоты всех состояний). */
  fields: 30,
} as const;

/** Системные строки окна проекта (#496, Р3, В16): двигаются, растягиваются
 *  и переименовываются, но не убираются. Порядок — нынешнее окно проекта
 *  (`project-create-dialog.tsx`): после атрибутов типа. Название и тип —
 *  не элементы, всегда первыми. */
export const PROJECT_SYSTEM_KEYS = [
  'manager',
  'assistants',
  'observers',
  'portfolio',
  'visibility',
  'endDate',
  'description',
] as const;
export const projectSystemKeySchema = z.enum(PROJECT_SYSTEM_KEYS);
export type ProjectSystemKey = z.infer<typeof projectSystemKeySchema>;

export const projectSystemElementSchema = z
  .object({
    kind: z.literal('system'),
    key: projectSystemKeySchema,
    /** Подпись строки в окне; null — стандартная. */
    label: z.string().trim().min(1).max(60).nullable().optional(),
    width: formWidthSchema.optional(),
    /** Высота — только у «Описания». */
    height: formHeightSchema.optional(),
  })
  .strict();
export type ProjectSystemElement = z.infer<typeof projectSystemElementSchema>;

/** Элемент окна проекта: слот атрибута, оформление или системная строка. */
export const projectTypeFormElementSchema = z.union([
  fieldFormSlotSchema,
  formDecorSchema,
  projectSystemElementSchema,
]);
export type ProjectTypeFormElement = FieldFormSlot | FormDecor | ProjectSystemElement;

export function isProjectSystemElement(element: unknown): element is ProjectSystemElement {
  return (
    element !== null &&
    typeof element === 'object' &&
    (element as { kind?: unknown }).kind === 'system'
  );
}

export const projectTypeFormSchema = z
  .object({
    fields: z
      .array(projectTypeFormElementSchema)
      .max(PROJECT_TYPE_LIMITS.fields + FORM_LAYOUT_LIMITS.decor + PROJECT_SYSTEM_KEYS.length),
  })
  .strict()
  .superRefine((form, ctx) => {
    refineAttributeElements(form.fields, ctx, {
      fields: PROJECT_TYPE_LIMITS.fields,
      decor: FORM_LAYOUT_LIMITS.decor,
    });
    const systemKeys = form.fields.filter(isProjectSystemElement).map((element) => element.key);
    if (new Set(systemKeys).size !== systemKeys.length) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'duplicate system element' });
    }
  });
export type ProjectTypeForm = z.infer<typeof projectTypeFormSchema>;

/** Умолчание: атрибутов нет (посев миграции добавит «Шифр» и «Заказчик»). */
export const DEFAULT_PROJECT_TYPE_FORM: ProjectTypeForm = { fields: [] };

/** Толерантное чтение формы типа (`{}`/битое → умолчание). */
export function projectTypeFormOf(type: { form?: unknown }): ProjectTypeForm {
  const parsed = projectTypeFormSchema.safeParse(type.form);
  return parsed.success ? parsed.data : DEFAULT_PROJECT_TYPE_FORM;
}

/** Недостающие системные строки — в конец, в нынешнем порядке окна (C20):
 *  окно по умолчанию совпадает с сегодняшним. */
export function withProjectSystemElements(form: ProjectTypeForm): ProjectTypeForm {
  const present = new Set(form.fields.filter(isProjectSystemElement).map((element) => element.key));
  const missing = PROJECT_SYSTEM_KEYS.filter((key) => !present.has(key)).map(
    (key): ProjectSystemElement => ({ kind: 'system', key }),
  );
  return missing.length === 0 ? form : { fields: [...form.fields, ...missing] };
}

/** Эффективная форма типа: только слоты существующих определений (#646),
 *  оформление и все системные строки (#496, C20). Зеркало
 *  `effectiveNodeForm`: удалённый атрибут не должен блокировать создание
 *  проекта required-слотом, которого нет в форме. */
export function effectiveProjectTypeForm(
  type: { form?: unknown },
  definitions: readonly { id: string }[],
): ProjectTypeForm {
  const form = projectTypeFormOf(type);
  const known = new Set(definitions.map((definition) => definition.id));
  return withProjectSystemElements({
    fields: form.fields.filter((element) => !isFieldFormSlot(element) || known.has(element.fieldId)),
  });
}

/** Обязательные слоты формы типа (id атрибутов). */
export function requiredProjectFields(form: ProjectTypeForm): string[] {
  return formSlots(form)
    .filter((slot) => slot.state === 'required')
    .map((slot) => slot.fieldId);
}

/** Чего не хватает для формы типа (обязательные слоты после умолчаний):
 *  проверка создания/правки проекта. Отказ — 422 PROJECT_FIELDS_REQUIRED. */
export function missingProjectFields(
  form: ProjectTypeForm,
  input: { customFields?: CustomFieldValues },
): string[] {
  return requiredProjectFields(form).filter(
    (fieldId) => !isCustomFieldValueFilled(input.customFields?.[fieldId]),
  );
}

/** Ключи обязательных полей, которые патч очищает (`null`/пусто) — 422
 *  `PROJECT_FIELDS_REQUIRED { reason: 'clear' }` (зеркало папок). */
export function clearedProjectFields(
  requiredIds: readonly string[],
  values: Readonly<Record<string, unknown>>,
): string[] {
  return requiredIds.filter((id) => id in values && !isCustomFieldValueFilled(values[id]));
}

/** Тип проекта — справочник «Автоматизации» (сид: «Договор», «Тема»).
 *  Форма типа — слоты атрибутов (Р10): диалоги проекта показывают только
 *  привязанные типу атрибуты в состояниях слотов. */
export const projectTypeRefSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});
export type ProjectTypeRef = z.infer<typeof projectTypeRefSchema>;

/** Портфель — плоский список группировки проектов (один заказчик — один
 *  большой объект; состав заказчиков выводится из проектов). */
export const projectGroupRefSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});
export type ProjectGroupRef = z.infer<typeof projectGroupRefSchema>;

/** Моё участие в проекте: перечисление источников (false везде — не участвую;
 *  «участник» = динамика задач или ручной member). */
export const projectMyMembershipSchema = z.object({
  manager: z.boolean(),
  assistant: z.boolean(),
  participant: z.boolean(),
  observer: z.boolean(),
});
export type ProjectMyMembership = z.infer<typeof projectMyMembershipSchema>;

export const projectListItemSchema = z.object({
  id: z.uuid(),
  /** Шифр договора; null — «тема» без шифра. */
  code: z.string().min(1).nullable(),
  name: z.string().min(1),
  color: projectColorSchema,
  /** Руководитель проекта (дефолт — создатель). */
  manager: userRefSchema.nullable(),
  /** Помощники руководителя (несколько, ≤ 10). */
  assistants: z.array(userRefSchema),
  myMembership: projectMyMembershipSchema,
  visibility: projectVisibilitySchema,
  status: projectStatusSchema,
  type: projectTypeRefSchema.nullable(),
  portfolio: projectGroupRefSchema.nullable(),
  /** Заказчик — контрагент справочника (#460, ADR-0033). */
  client: counterpartyRefSchema.nullable(),
  /** Участники — живой состав БЕЗ наблюдателей (руководство, задачи,
   *  ручное добавление); наблюдатели — отдельным полем карточки. */
  membersCount: z.number().int().min(0),
  membersPreview: z.array(userRefSchema),
  endDate: z.iso.date().nullable(),
  /** Последняя активность (для сортировки журнала). */
  activityAt: z.iso.datetime(),
  /** Атрибуты строки списка (#632, Р9): значения, ссылки и формулы — колонки
   *  журнала проектов показывают их без отдельных запросов. */
  customFields: customFieldValuesSchema.optional(),
  customFieldRefs: z.array(customFieldRefSchema).optional(),
  customFieldFormulas: customFieldFormulasSchema.optional(),
});

export type ProjectListItem = z.infer<typeof projectListItemSchema>;

/** Что текущий сотрудник может с проектом (сервер — истина, I8). */
export const projectAccessSchema = z.object({
  /** Правка полей, статусы, состав (руководитель, помощники, project.manage). */
  canManage: z.boolean(),
  /** Управление составом (секретный: добавить/снять участника и наблюдателя). */
  canManageMembers: z.boolean(),
  /** «Присоединиться» (открытый, не-участник). */
  canJoin: z.boolean(),
  /** «Покинуть» (вступивший наблюдатель). */
  canLeave: z.boolean(),
  /** Публикация в канал проекта. */
  canPostToChannel: z.boolean(),
  /** Передача руководства (только действующий руководитель). */
  canTransfer: z.boolean(),
});
export type ProjectAccess = z.infer<typeof projectAccessSchema>;

export const projectDetailSchema = projectListItemSchema.extend({
  description: z.string(),
  creator: userRefSchema,
  /** Наблюдатели проекта (источник `observer`: приглашённые руководством,
   *  вступившие сами, создатель-не-руководитель) — просмотр без прав правки.
   *  Вердикт владельца 29.10 (В2): наблюдатель — ручной механизм состава,
   *  участники же приходят из задач. */
  observers: z.array(userRefSchema),
  startDate: z.iso.date().nullable(),
  completedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** Значения атрибутов проекта по id определения (одно определение на
   *  портал; место — тип проекта, #631). */
  customFields: customFieldValuesSchema,
  customFieldRefs: z.array(customFieldRefSchema),
  /** Формульные ячейки (#632): своя/типовая формула и ошибка (производное). */
  customFieldFormulas: customFieldFormulasSchema.optional(),
  access: projectAccessSchema,
  /** Сводка структуры (#467): дефолт вкладки карточки — «Структура» первична,
   *  когда есть узел с прямыми задачами-детьми (вердикт владельца 07.11). */
  structureSummary: z.object({
    nodeCount: z.number().int().min(0),
    hasTaskNodes: z.boolean(),
  }),
  createdAt: z.iso.datetime(),
});

export type ProjectDetail = z.infer<typeof projectDetailSchema>;

/** Лимиты проекта (допущения техплана #52). */
export const PROJECT_LIMITS = {
  assistants: 10,
  observers: 100,
  nameLength: 200,
  codeLength: 64,
  descriptionLength: 2000,
} as const;

/** Бизнес-роль сотрудника в проекте (не источник `ProjectParticipant.source`):
 *  `participant` объединяет `task` и `member`. Один словарь на журнал проектов,
 *  фильтры и источники решающих (#433). */
export const projectRoleSchema = z.enum(['manager', 'assistant', 'participant', 'observer']);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const listProjectsQuerySchema = cursorQuerySchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  search: z.string().trim().min(1).max(128).optional(),
  /** «Моя роль»: руководитель / помощник / участник / наблюдатель. */
  role: projectRoleSchema.optional(),
  visibility: projectVisibilitySchema.optional(),
  status: projectStatusSchema.optional(),
  portfolioId: z.uuid().optional(),
  /** Проекты сотрудника (вкладка «Проекты» карточки сотрудника). */
  memberId: z.uuid().optional(),
  /** Проекты заказчика (вкладка «Проекты» карточки контрагента, #460). */
  clientId: z.uuid().optional(),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

/** Создание проекта: простое окно (мастер — #468). Видимость по умолчанию —
 *  настройка портала (Р7); руководитель по умолчанию — создатель. */
export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(PROJECT_LIMITS.nameLength),
  code: z.string().trim().min(1).max(PROJECT_LIMITS.codeLength).optional(),
  description: z.string().trim().max(PROJECT_LIMITS.descriptionLength).optional(),
  color: projectColorSchema.optional(),
  /** Тип обязателен (допущение: сид «Договор» + «Тема»). */
  typeId: z.uuid(),
  portfolioId: z.uuid().nullable().optional(),
  clientId: z.uuid().nullable().optional(),
  managerId: z.uuid().optional(),
  assistantIds: z.array(z.uuid()).max(PROJECT_LIMITS.assistants).optional(),
  /** Наблюдатели, заданные при создании (просмотр без прав правки): ручные
   *  ряды source=observer/kind=invited. Участники приходят из задач. */
  observers: z.array(z.uuid()).max(PROJECT_LIMITS.observers).optional(),
  visibility: projectVisibilitySchema.optional(),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  /** Значения counter-полей отбрасываются молча (номер выдаёт процесс, #630). */
  customFields: customFieldValuesInputSchema.optional(),
  /** Номер «при создании» с пустым полем в виде номера — подтверждено (#630). */
  confirmEmptyNumberParts: z.literal(true).optional(),
});

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

/** Правка полей (руководитель, помощники, project.manage): null очищает.
 *  Передача руководства, смена видимости на секретный и статусы — отдельные
 *  действия (допущения #52); перенос между портфелями — здесь. */
export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(PROJECT_LIMITS.nameLength).optional(),
    code: z.string().trim().min(1).max(PROJECT_LIMITS.codeLength).nullable().optional(),
    description: z.string().trim().max(PROJECT_LIMITS.descriptionLength).nullable().optional(),
    color: projectColorSchema.optional(),
    portfolioId: z.uuid().nullable().optional(),
    clientId: z.uuid().nullable().optional(),
    assistantIds: z.array(z.uuid()).max(PROJECT_LIMITS.assistants).optional(),
    visibility: projectVisibilitySchema.optional(),
    startDate: z.iso.date().nullable().optional(),
    endDate: z.iso.date().nullable().optional(),
    customFields: customFieldValuesPatchSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

/** Статусные действия: завершение — метка; архив — заморозка (создание задач
 *  в проекте — 422); возврат в работу — руководитель или project.manage. */
export const projectStatusBodySchema = z.object({
  status: projectStatusSchema,
});

export type ProjectStatusBody = z.infer<typeof projectStatusBodySchema>;

/** Передача руководства: прежний руководитель без иных источников участия
 *  становится наблюдателем-создателем (Т5). */
export const projectTransferBodySchema = z.object({
  managerId: z.uuid(),
});

export type ProjectTransferBody = z.infer<typeof projectTransferBodySchema>;

/** Строка вкладки «Участники»: сотрудник + источник участия. */
export const projectMemberSchema = z.object({
  user: userRefSchema,
  source: projectParticipantSourceSchema,
  observerKind: projectObserverKindSchema.nullable(),
  joinedAt: z.iso.datetime(),
});

export type ProjectMember = z.infer<typeof projectMemberSchema>;

/** Ручное добавление руководством: в секретный — участник или наблюдатель,
 *  в открытый — только наблюдатель (участники открытого живут из задач). */
export const projectMemberAddBodySchema = z.object({
  userId: z.uuid(),
  kind: projectMembershipKindSchema,
});

export type ProjectMemberAddBody = z.infer<typeof projectMemberAddBodySchema>;

// ===== История проекта (вкладка «История») =====

/** Вид события ленты: создание, правка полей, смена состава, смена статуса.
 *  Источник — outbox `project.*` (I9): лента не дублирует данные, а читает
 *  журнал событий агрегата. */
export const projectHistoryKindSchema = z.enum([
  'created',
  'updated',
  'participants_changed',
  'status_changed',
]);
export type ProjectHistoryKind = z.infer<typeof projectHistoryKindSchema>;

export const projectHistoryEntrySchema = z.object({
  id: z.uuid(),
  kind: projectHistoryKindSchema,
  /** Автор действия; null — системное событие. */
  actor: userRefSchema.nullable(),
  createdAt: z.iso.datetime(),
  /** Изменённые ключи (`updated`): системные ключи и `cf.<id>` атрибутов. */
  fields: z.array(z.string()),
  /** Новый статус (`status_changed`). */
  status: projectStatusSchema.nullable(),
  /** Люди события (`participants_changed`) — состав изменился у них. */
  users: z.array(userRefSchema),
  /** Название на момент события (`created`). */
  name: z.string().nullable(),
});

export type ProjectHistoryEntry = z.infer<typeof projectHistoryEntrySchema>;

// ===== Типы проектов («Автоматизация», право project.setup.manage) =====

export const projectTypeSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  /** Значок и цвет типа — грамматика «Процессов» (#556, вердикт владельца
   *  02.11): тип узнаётся по плитке в левом списке «Схем проектов». */
  icon: processTypeIconSchema,
  color: projectColorSchema,
  /** Слоты атрибутов типа (Р10 #631): «Шифр» — обычный атрибут в слоте,
   *  бывший сегмент политики шифра из настроек типа убран. */
  form: projectTypeFormSchema,
  /** Допустимые виды папок проекта этого типа (#556, вердикт владельца
   *  02.11): `null` — все виды справочника; массив — только перечисленные.
   *  Создание папки и смена вида вне списка — 422
   *  PROJECT_NODE_KIND_NOT_ALLOWED; существующие папки не ломаются (снятый
   *  с типа вид живёт у уже созданных папок). */
  kindIds: z.array(z.uuid()).max(50).nullable(),
  archivedAt: z.iso.datetime().nullable(),
});

export type ProjectType = z.infer<typeof projectTypeSchema>;

export const projectTypeCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: processTypeIconSchema.optional(),
  color: projectColorSchema.optional(),
  /** Слоты атрибутов нового типа (Р10). */
  form: projectTypeFormSchema.optional(),
});

export type ProjectTypeCreateBody = z.infer<typeof projectTypeCreateBodySchema>;

export const projectTypeUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: processTypeIconSchema.optional(),
    color: projectColorSchema.optional(),
    /** Слоты атрибутов типа — замена целиком (Р10). */
    form: projectTypeFormSchema.optional(),
    /** Допустимые виды папок типа (#556): null — все, массив — только эти. */
    kindIds: z.array(z.uuid()).max(50).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type ProjectTypeUpdateBody = z.infer<typeof projectTypeUpdateBodySchema>;

// ===== Портфели (плоский список) =====

export const projectGroupSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  archivedAt: z.iso.datetime().nullable(),
});

export type ProjectGroup = z.infer<typeof projectGroupSchema>;

export const projectGroupCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type ProjectGroupCreateBody = z.infer<typeof projectGroupCreateBodySchema>;

export const projectGroupUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type ProjectGroupUpdateBody = z.infer<typeof projectGroupUpdateBodySchema>;

// ===== Настройки портала (Р7: окно «Настройки портала») =====

/** Живые настройки портала; ключи добавляются с новыми жильцами окна. */
export const portalSettingsSchema = z.object({
  projects: z.object({
    /** Видимость новых проектов по умолчанию (дефолт кода — 'open'). */
    defaultVisibility: projectVisibilitySchema,
  }),
});

export type PortalSettings = z.infer<typeof portalSettingsSchema>;

export const portalSettingsUpdateBodySchema = z.object({
  projects: z.object({
    defaultVisibility: projectVisibilitySchema,
  }),
});

export type PortalSettingsUpdateBody = z.infer<typeof portalSettingsUpdateBodySchema>;
