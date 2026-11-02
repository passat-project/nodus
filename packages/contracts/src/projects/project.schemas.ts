import { z } from 'zod';

import { counterpartyRefSchema } from '../counterparties/counterparty.schemas.js';
import { customFieldRefSchema } from '../custom-fields/custom-field-refs.js';
import {
  customFieldValuesInputSchema,
  customFieldValuesPatchSchema,
  customFieldValuesSchema,
} from '../custom-fields/custom-field-values.js';
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

/** Политика системного поля «Шифр» у типа: hidden — поля в форме нет
 *  («Тема»), optional — по желанию, required — обязательно («Договор»).
 *  Мост к формам типов (#38/#468): полный набор полей типа — схемой формы. */
export const projectCodeFieldSchema = z.enum(['hidden', 'optional', 'required']);
export type ProjectCodeField = z.infer<typeof projectCodeFieldSchema>;

/** Тип проекта — справочник «Автоматизации» (сид: «Договор», «Тема»).
 *  `codeField` — политика системного поля «Шифр» (см. ниже): карточка и
 *  окна создания/правки показывают поле только там, где оно есть у типа. */
export const projectTypeRefSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  codeField: projectCodeFieldSchema,
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
  /** Значения кастомных атрибутов области `project` по id определения. */
  customFields: customFieldValuesSchema,
  customFieldRefs: z.array(customFieldRefSchema),
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

export const listProjectsQuerySchema = cursorQuerySchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  search: z.string().trim().min(1).max(128).optional(),
  /** «Моя роль»: руководитель / помощник / участник / наблюдатель. */
  role: z.enum(['manager', 'assistant', 'participant', 'observer']).optional(),
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
  customFields: customFieldValuesInputSchema.optional(),
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
  codeField: projectCodeFieldSchema,
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
});

export type ProjectTypeCreateBody = z.infer<typeof projectTypeCreateBodySchema>;

export const projectTypeUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: processTypeIconSchema.optional(),
    color: projectColorSchema.optional(),
    codeField: projectCodeFieldSchema.optional(),
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
