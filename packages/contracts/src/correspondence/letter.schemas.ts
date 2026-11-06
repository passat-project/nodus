import { z } from 'zod';

import { contactRefSchema, counterpartyRefSchema } from '../counterparties/counterparty.schemas.js';
import { customFieldRefSchema } from '../custom-fields/custom-field-refs.js';
import { customFieldFormulasSchema } from '../custom-fields/formula-api.schemas.js';
import {
  customFieldValuesPatchSchema,
  customFieldValuesSchema,
} from '../custom-fields/custom-field-values.js';
import { userRefSchema } from '../directory/user-ref.schema.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';
import { projectRefSchema } from '../projects/project.schemas.js';
import { taskStageSchema } from '../tasks/task.schemas.js';
import { letterDirectionSchema, processTypeRefSchema } from '../workflows/process-type.schemas.js';
import { LETTER_LIMITS, letterAttachedRefInputSchema } from './letter-registration.schemas.js';

/**
 * Контракты модуля корреспонденции (#55, ADR-0027): письмо — сущность
 * модуля `correspondence` на движке «Процессы» (категория `letter`): тип
 * процесса, стадия маршрута, кнопки и окна переходов — общие с задачами.
 * Регистрация — кнопка маршрута с окном «Регистрация» и номером серии
 * «Вх-ГГГГ/N» (`letter-registration.schemas.ts`); резолюция, поручения,
 * связи и конфиденциальность — #461/#463.
 */

/** Вкладка списка: «Новые» (незарегистрированные входящие, только
 *  `correspondence.register`), «Входящие», «Исходящие». */
export const letterBoxSchema = z.enum(['new', 'incoming', 'outgoing']);
export type LetterBox = z.infer<typeof letterBoxSchema>;

/** Как письмо попало в систему: создано вручную (скан бумаги) или пришло
 *  почтой (#56). Способ поступления для реестра — справочник `receipt-method`. */
export const letterSourceSchema = z.enum(['manual', 'mail']);
export type LetterSource = z.infer<typeof letterSourceSchema>;

/** Роль файла письма (Р8): главный документ (скан, PDF письма) — один,
 *  тело письма почты (HTML/текст) — одно, PDF-копия тела («Основной документ
 *  письма» #56: системный кандидат, рождается конвертацией Gotenberg, роль
 *  неизменна — главным становится де-факто, когда `main` не выбран),
 *  приложения, исходник (.eml, #56). */
export const letterAttachmentRoleSchema = z.enum([
  'main',
  'body',
  'body_pdf',
  'attachment',
  'source',
]);
export type LetterAttachmentRole = z.infer<typeof letterAttachmentRoleSchema>;

export const letterAttachmentSchema = z.object({
  id: z.uuid(),
  /** Файл модуля files (сессия просмотра, PDF-копия, подпись ссылки). */
  fileId: z.uuid(),
  role: letterAttachmentRoleSchema,
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().min(0),
  /** Content-ID MIME-части (#56): связывает inline-картинку HTML-тела с
   *  вложением (cid: резолв на показе); null — обычное вложение. */
  contentId: z.string().min(1).nullable(),
  /** Inline-часть письма (картинка в HTML-теле): из блока «Файлы» скрыта. */
  inline: z.boolean(),
  /** Подписанная ссылка содержимого (выдаётся только после проверки
   *  видимости письма). */
  url: z.string().min(1),
  /** PDF-копия офисного документа (конвейер производных); null — не готова
   *  или не офис. */
  pdfUrl: z.string().nullable(),
  /** Маршрут просмотрщика — серверная классификация (mime клиента не доверяем). */
  previewKind: z.enum(['office', 'pdf', 'image', 'video', 'file']),
});
export type LetterAttachment = z.infer<typeof letterAttachmentSchema>;

/** Что показывает вкладка «Тело» (Р8): главный документ во вьювере, иначе
 *  тело почты (HTML — песочница, text/plain — текст), иначе пусто. */
/** Что показывает вкладка «Письмо»: документ во вьювере, иначе пусто.
 *  Текст письма существует в продукте ТОЛЬКО PDF-копией — HTML/текстовые
 *  варианты тела убраны (вердикт владельца 28.10: «текст письма только pdf
 *  всегда», «Основной документ письма» #56). */
export const letterBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document'), attachmentId: z.uuid() }),
  z.object({ kind: z.literal('none') }),
]);
export type LetterBody = z.infer<typeof letterBodySchema>;

/** Короткая ссылка на письмо (беседы чата писем, превью ссылок): у
 *  незарегистрированного номера нет, у бумажного скана может не быть темы. */
export const letterRefSchema = z.object({
  id: z.uuid(),
  regNumber: z.string().nullable(),
  subject: z.string().nullable(),
});
export type LetterRef = z.infer<typeof letterRefSchema>;

/** Вид связи писем (#461, Р1): «ответ на» (авто по почтовой цепочке или
 *  ручная канцелярией) и «вложено в» (матрёшка: письмо физически лежит в
 *  конверте другого). Виды независимы — матрёшка может быть и ответом. */
export const letterRelationKindSchema = z.enum(['reply_to', 'nested_in']);
export type LetterRelationKind = z.infer<typeof letterRelationKindSchema>;

/** Действие над связью (событие `letter_relations_changed`, история). */
export const letterRelationActionSchema = z.enum(['linked', 'unlinked', 'replaced']);
export type LetterRelationAction = z.infer<typeof letterRelationActionSchema>;

/** Строка «приложенных писем» в карточке (#461, Р3): № листа, организация
 *  (контрагент справочника — единственный источник, вердикт владельца
 *  05.11.2026) и дата. Вложения-файлы сюда не входят — это реестр вложенных
 *  ДОКУМЕНТОВ письма. */
export const letterAttachedRefSchema = z.object({
  id: z.uuid(),
  number: z.string().min(1),
  counterparty: counterpartyRefSchema,
  date: z.iso.date().nullable(),
});
export type LetterAttachedRef = z.infer<typeof letterAttachedRefSchema>;

/** Узел дерева «ёлочки» (#461, Р2): письмо и его дети по обоим видам
 *  связей (ответы — reply_to на него, вложенные — nested_in на него).
 *  Невидимые зрителю узлы исключает сервер (поддерево скрытого
 *  промежуточного узла не всплывает). */
export interface LetterTreeNode {
  id: string;
  regNumber: string | null;
  theirNumber: string | null;
  subject: string | null;
  direction: 'incoming' | 'outgoing';
  systemState: z.infer<typeof taskStageSchema>['systemState'];
  confidential: boolean;
  /** Связь узла с родителем (id — для «Снять», вид — для «Заменить»);
   *  у корня дерева null. */
  relationId: string | null;
  relationKind: LetterRelationKind | null;
  children: LetterTreeNode[];
}

export const letterTreeNodeSchema: z.ZodType<LetterTreeNode> = z.lazy(() =>
  z.object({
    id: z.uuid(),
    regNumber: z.string().nullable(),
    theirNumber: z.string().nullable(),
    subject: z.string().nullable(),
    direction: letterDirectionSchema,
    systemState: taskStageSchema.shape.systemState,
    confidential: z.boolean(),
    relationId: z.uuid().nullable(),
    relationKind: letterRelationKindSchema.nullable(),
    children: z.array(letterTreeNodeSchema),
  }),
);

/** `GET /letters/:id/tree` (#461, Р2): корень — запрошенное письмо,
 *  `truncated` — дерево обрезано капом глубины/узлов («показаны не все»). */
export const letterTreeResponseSchema = z.object({
  root: letterTreeNodeSchema,
  truncated: z.boolean(),
});
export type LetterTreeResponse = z.infer<typeof letterTreeResponseSchema>;

/** Элемент справочника способов поступления (`receipt-method`, Р14). */
export const receiptMethodRefSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});
export type ReceiptMethodRef = z.infer<typeof receiptMethodRefSchema>;

export const letterListItemSchema = z.object({
  id: z.uuid(),
  /** Тип процесса письма («Входящее письмо», «Исходящее письмо»). */
  typeId: z.uuid(),
  direction: letterDirectionSchema,
  /** Стадия маршрута типа (чип статуса). */
  stage: taskStageSchema,
  /** «Вх-2026/118»; null — не зарегистрировано. */
  regNumber: z.string().nullable(),
  /** Дата регистрации (ISO-дата часового пояса компании). */
  regDate: z.iso.date().nullable(),
  registeredAt: z.iso.datetime().nullable(),
  /** Поступило в систему (почта — время приёма, вручную — создания). */
  receivedAt: z.iso.datetime(),
  source: letterSourceSchema,
  /** Отправитель почтового конверта (#56, Р9): строка очереди «Новые»
   *  показывает «Имя <адрес>»; у ручного письма — null («внесено вручную»). */
  mailFromName: z.string().nullable(),
  mailFromAddress: z.string().min(3).nullable(),
  /** Тема: у почты — из письма, у бумажного скана до регистрации — пусто. */
  subject: z.string().nullable(),
  /** Корреспондент — ссылка на справочник контрагентов (I15); до
   *  регистрации может быть пусто. */
  counterparty: counterpartyRefSchema.nullable(),
  /** № и дата документа корреспондента. */
  theirNumber: z.string().nullable(),
  theirDate: z.iso.date().nullable(),
  receiptMethod: receiptMethodRefSchema.nullable(),
  project: projectRefSchema.nullable(),
  addressee: userRefSchema.nullable(),
  /** Срок ответа (ISO-дата); по умолчанию не ставится. */
  responseDeadline: z.iso.date().nullable(),
  /** Авто-связь «ответ на» по почтовой цепочке (#56, Р5): предок-исходящее
   *  (registered) или null. */
  replyTo: letterRefSchema.nullable(),
  /** Файлов письма (без исходника .eml). */
  attachmentCount: z.number().int().min(0),
  /** Личный признак «я открывал» (редизайн #56): гаснет в списке «Новые»
   *  после POST /letters/:id/view; в карточке всегда true. */
  viewed: z.boolean(),
  /** «Конфиденциально» (#461, Р4): письмо, его чат, файлы и поручения видят
   *  только участники (и держатели `correspondence.view_confidential`).
   *  Строка в списках есть только у видящих — бейдж не оракул. */
  confidential: z.boolean(),
  /** Атрибуты строки списка (#632, Р9): значения, имена ссылок и формульное
   *  состояние — колонки видов показывают их без отдельных запросов. */
  customFields: customFieldValuesSchema.optional(),
  customFieldRefs: z.array(customFieldRefSchema).optional(),
  customFieldFormulas: customFieldFormulasSchema.optional(),
});
export type LetterListItem = z.infer<typeof letterListItemSchema>;

/** Что может текущий сотрудник с письмом (сервер — истина, I8; веб прячет
 *  недоступное): правка регистрационных данных (В3), удаление спама из
 *  «Новых» (Р12), «Присоединиться к обсуждению» (Р10). */
export const letterAccessSchema = z.object({
  canEdit: z.boolean(),
  canDeleteSpam: z.boolean(),
  canJoin: z.boolean(),
  /** Участник чата письма (адресат или присоединившийся). */
  isParticipant: z.boolean(),
});
export type LetterAccess = z.infer<typeof letterAccessSchema>;

/** Почтовые реквизиты письма (заголовки конверта, #56); null — вручную. */
export const letterMailInfoSchema = z.object({
  fromAddress: z.string().min(3),
  fromName: z.string().nullable(),
  /** Message-ID конверта (дедуп и связи цепочки); null — письмо без него. */
  messageId: z.string().nullable(),
  /** Письмо не разобрано целиком — реквизиты и файлы неполные (битое
   *  письмо не блокирует очередь — анти-яд). */
  parseIssue: z.boolean(),
  /** Часть письма не сохранена (исходник сверх потолка, вложения сверх
   *  лимита) — карточка помечает. */
  storageIncomplete: z.boolean(),
  /** PDF-копия тела не создана (конвертер недоступен/отказал после ретраев —
   *  «Основной документ письма» #56): кандидат «текст-PDF» недоступен, текст
   *  читается вкладкой «Текст письма». */
  bodyPdfIssue: z.boolean(),
});
export type LetterMailInfo = z.infer<typeof letterMailInfoSchema>;

/** Подстановка контрагента по адресу отправителя (Р6, В2): ровно один
 *  активный контакт справочника с таким адресом; подписант — этот контакт. */
export const letterCounterpartySuggestionSchema = z.object({
  counterpartyId: z.uuid(),
  signerId: z.uuid(),
});
export type LetterCounterpartySuggestion = z.infer<typeof letterCounterpartySuggestionSchema>;

export const letterDetailSchema = letterListItemSchema.extend({
  type: processTypeRefSchema,
  /** Подписант — контакт корреспондента. */
  signer: contactRefSchema.nullable(),
  registrar: userRefSchema.nullable(),
  /** Почтовые реквизиты (#56); null — бумажное письмо, внесённое вручную. */
  mail: letterMailInfoSchema.nullable(),
  /** Нечёткая подсказка связи (тема «на № N от ДД.ММ.ГГГГ», Р5): приходит,
   *  только если авто-связи по цепочке нет; регистратор подтверждает
   *  галочкой в форме. */
  replySuggestion: letterRefSchema.nullable(),
  /** Контрагент и подписант по адресу отправителя (Р6, В2); null — адреса
   *  нет в справочнике или совпадений несколько. */
  counterpartySuggestion: letterCounterpartySuggestionSchema.nullable(),
  attachments: z.array(letterAttachmentSchema),
  body: letterBodySchema,
  /** Атрибуты области `letter`, привязанные к типу (ADR-0029). */
  customFields: customFieldValuesSchema,
  customFieldRefs: z.array(customFieldRefSchema),
  /** Формульные ячейки (#632): своя/типовая формула и ошибка (производное). */
  customFieldFormulas: customFieldFormulasSchema.optional(),
  /** Строки «приложенных писем» (#461, Р3): № + организация + дата. */
  attachedRefs: z.array(letterAttachedRefSchema),
  /** Канцелярия правит связи (#461, Р1а, В2): «Добавить/Заменить/Снять». */
  canManageRelations: z.boolean(),
  access: letterAccessSchema,
});
export type LetterDetail = z.infer<typeof letterDetailSchema>;

/** `GET /letters`: без `box` — зарегистрированные обоих направлений
 *  (палитра, вкладка «Письма» контрагента); `box=new` — только
 *  `correspondence.register` (иначе 403). Курсор: «Новые» —
 *  `(received_at, id) DESC`, остальное — `(registered_at, id) DESC`. */
export const listLettersQuerySchema = cursorQuerySchema.extend({
  box: letterBoxSchema.optional(),
  counterpartyId: z.uuid().optional(),
  search: z.string().trim().min(1).max(LETTER_LIMITS.search).optional(),
});
export type ListLettersQuery = z.infer<typeof listLettersQuerySchema>;

/** Поля multipart `POST /letters` (ручное создание входящего в «Новое»):
 *  идут ДО файлов; файлы 1–20, главный документ — `mainIndex` (по
 *  умолчанию первый). Значения multipart — строки, отсюда coerce. */
export const createLetterFieldsSchema = z.object({
  typeId: z.uuid(),
  mainIndex: z.coerce
    .number()
    .int()
    .min(0)
    .max(LETTER_LIMITS.files - 1)
    .default(0),
});
export type CreateLetterFields = z.infer<typeof createLetterFieldsSchema>;

/** `PATCH /letters/:id` — правка реквизитов письма канцелярией (В3, Р11;
 * редизайн #56 — и незарегистрированного по месту в карточке): номер так не
 * меняется никогда; адресат — только до регистрации (после —
 * LETTER_NOT_EDITABLE). Явные необязательные поля без `.default()` (gotcha
 * Zod 4: умолчания в патче перетирали бы непереданное); `null` — очистить
 * необязательное. */
export const updateLetterBodySchema = z
  .object({
    counterpartyId: z.uuid().optional(),
    signerId: z.uuid().nullable().optional(),
    theirNumber: z.string().trim().min(1).max(LETTER_LIMITS.theirNumber).optional(),
    theirDate: z.iso.date().optional(),
    subject: z.string().trim().min(1).max(LETTER_LIMITS.subject).optional(),
    receiptMethodId: z.uuid().optional(),
    projectId: z.uuid().nullable().optional(),
    /** Адресат: только незарегистрированное письмо (редизайн #56 — поля
     *  заполняются по месту в карточке до регистрации). */
    addresseeId: z.uuid().nullable().optional(),
    responseDeadline: z.iso.date().nullable().optional(),
    /** «Конфиденциально» (#461, Р4): включается/снимается канцелярией в
     *  карточке; снятие возвращает письмо в общие списки (история). */
    confidential: z.boolean().optional(),
    /** Строки «приложенных писем» целиком (#461, Р3): ввод при регистрации
     *  и правка в карточке; сервер заменяет набор и пишет историю счётчиком. */
    attachedRefs: z.array(letterAttachedRefInputSchema).max(LETTER_LIMITS.attachedRefs).optional(),
    customFields: customFieldValuesPatchSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type UpdateLetterBody = z.infer<typeof updateLetterBodySchema>;

/** `POST /letters/:id/relations` (#461, Р1/Р1а): канцелярия ставит связь
 *  «ответ на» или «вложено в» на живое зарегистрированное письмо, видимое
 *  ей. Повтор той же цели — идемпотентный успех; другая цель при уже
 *  существующей связи того же вида — 422 `already_linked`, пока клиент не
 *  попросит `replace` (окно «заменит существующую»). */
export const letterRelationCreateBodySchema = z
  .object({
    relatedLetterId: z.uuid(),
    kind: letterRelationKindSchema,
    replace: z.boolean().optional(),
  })
  .strict();
export type LetterRelationCreateBody = z.infer<typeof letterRelationCreateBodySchema>;

/** `POST /letters/:id/participants` — пригласить коллег в обсуждение
 *  (редизайн #56; множественный выбор — приёмка 28.10): только держатель
 *  `correspondence.register`, письмо в любом состоянии, 1–20 сотрудников,
 *  повторные приглашения идемпотентны. */
export const addLetterParticipantBodySchema = z
  .object({ userIds: z.array(z.uuid()).min(1).max(20) })
  .strict();
export type AddLetterParticipantBody = z.infer<typeof addLetterParticipantBodySchema>;

/** `POST /letters/:id/main-document` — выбор основного документа письма
 *  («Основной документ письма» #56): канцелярия до регистрации помечает
 *  звёздочкой один из файлов-кандидатов (вложение или PDF-копию тела) —
 *  этот документ открывает вкладка «Письмо» и получает номер при
 *  регистрации. После регистрации выбор заморожен (LETTER_NOT_EDITABLE).
 *  Повтор того же выбора — не ошибка (идемпотентность). */
export const setLetterMainDocumentBodySchema = z.object({ attachmentId: z.uuid() }).strict();
export type SetLetterMainDocumentBody = z.infer<typeof setLetterMainDocumentBodySchema>;

/** Изменение поля в истории (`letter_updated`): ключ — системное поле
 *  (`counterpartyId`, `theirDate`, …) или атрибут `cf.<uuid>`; значения —
 *  строки показа (ссылки — имена, гидрирует сервер; даты — ISO-дата,
 *  формат даёт веб по ключу поля); null — пусто. */
export const letterHistoryChangeSchema = z.object({
  field: z.string().min(1).max(64),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type LetterHistoryChange = z.infer<typeof letterHistoryChangeSchema>;

const historyEntryBase = {
  id: z.uuid(),
  at: z.iso.datetime(),
  /** Кто сделал; null — система (приём почты). */
  actor: userRefSchema.nullable(),
};

/** Запись истории письма (`GET /letters/:id/history`, event log по агрегату
 *  `letter`, Р11); страница — курсором. */
export const letterHistoryEntrySchema = z.discriminatedUnion('kind', [
  z.object({ ...historyEntryBase, kind: z.literal('received'), source: letterSourceSchema }),
  z.object({ ...historyEntryBase, kind: z.literal('registered'), regNumber: z.string().min(1) }),
  z.object({
    ...historyEntryBase,
    kind: z.literal('updated'),
    changes: z.array(letterHistoryChangeSchema).min(1).max(LETTER_LIMITS.changes),
  }),
  z.object({
    ...historyEntryBase,
    kind: z.literal('stage_changed'),
    transitionName: z.string().min(1),
    fromStageName: z.string().min(1),
    toStageName: z.string().min(1),
    comment: z.string().optional(),
  }),
  z.object({ ...historyEntryBase, kind: z.literal('participant_joined') }),
  /** Связь писем поставлена/снята/заменена (#461, Р6): номер второй стороны
   *  гидрирует сервер (ссылка, не текст). */
  z.object({
    ...historyEntryBase,
    kind: z.literal('relation_changed'),
    action: letterRelationActionSchema,
    relatedLetter: letterRefSchema,
    relationKind: letterRelationKindSchema,
  }),
]);
export type LetterHistoryEntry = z.infer<typeof letterHistoryEntrySchema>;
