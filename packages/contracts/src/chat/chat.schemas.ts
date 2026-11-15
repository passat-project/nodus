import { z } from 'zod';

import { letterRefSchema } from '../correspondence/letter.schemas.js';
import { userRefSchema } from '../directory/user-ref.schema.js';
import { projectRefSchema } from '../projects/project.schemas.js';
import { taskRefSchema } from '../tasks/task.schemas.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';
import { stickerMetaSchema } from './sticker.schemas.js';
import { chatMessageBlockSchema, chatMessageKindSchema } from './chat-block.schemas.js';
import { attachmentRenameSchema } from './chat-attachment.schemas.js';

/** Контракты модуля чата (chat.Conversation/Message). */

export const conversationTypeSchema = z.enum([
  'direct',
  'group',
  'project_channel',
  'task',
  'letter',
]);
export type ConversationType = z.infer<typeof conversationTypeSchema>;

export const messageAttachmentSchema = z.object({
  id: z.uuid(),
  /** Файл модуля files (сессия просмотра/версии, #138); plain UUID (I3). */
  fileId: z.uuid(),
  name: z.string().min(1),
  size: z.number().int().min(0),
  mime: z.string().min(1),
  /** Явный вид (НЕ выводить из mime: mime — для иконки и валидации):
   *  image — галерея, file — чип, sticker — стикер-глиф без пузыря (#143). */
  kind: z.enum(['image', 'file', 'sticker']),
  /** Метаданные стикера (только kind='sticker'): пак для поповера «Добавить
   *  пак» и рендер без доп-запроса; снапшот на момент отправки (#143). */
  sticker: stickerMetaSchema.nullish(),
  /** Адрес оригинала (в проде — MinIO через StorageDriver, I13). */
  url: z.string().nullable(),
  /** Превью для галереи (null у файлов). */
  thumbnailUrl: z.string().nullable(),
  /** Маршрут просмотрщика (#139): office | pdf | image | video | file —
   * серверная классификация (mime/расширению клиента не доверяем). */
  previewKind: z.enum(['office', 'pdf', 'image', 'video', 'file']),
  /** PDF-копия офисного документа (конвейер производных #139): fallback-
   * просмотр при выключенном/лежащем ONLYOFFICE; null — не готова/не офис. */
  pdfUrl: z.string().nullable(),
  /** Габариты изображения: резерв бокса до загрузки (лента без сдвига). */
  width: z.number().int().min(0).nullable(),
  height: z.number().int().min(0).nullable(),
});

export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

export const messageReactionSchema = z.object({
  emoji: z.string().min(1),
  count: z.number().int().min(1),
  mine: z.boolean(),
  /** Поставившие реакцию (в порядке постановки): тултип чипа — аватар+ФИО
   *  (вердикт владельца 27.09, реф Битрикс24). Инвариант: count === users.length. */
  users: z.array(userRefSchema),
});

export type MessageReaction = z.infer<typeof messageReactionSchema>;

/** Задел ЛИНИИ РЕАКЦИЙ (вердикт 24.09: реакции в компании — необходимость;
 *  контракт отображения уже выше: message.reactions c mine): toggle своей
 *  реакции. Эндпоинт и пикер придут со своей линией — схема готова заранее,
 *  чтобы без сюрпризов и переименований. */
export const messageReactionToggleBodySchema = z.object({
  emoji: z.string().min(1),
  /** true — снять свою реакцию; по умолчанию поставить. */
  remove: z.boolean().optional(),
});

export type MessageReactionToggleBody = z.infer<typeof messageReactionToggleBodySchema>;

/** Данные цитаты-ответа — ЗАМОРОЖЕННЫЙ снапшот на момент отправки (вердикт
 *  владельца 24.09: «нужно видеть то, на что отвечал сотрудник»; правка
 *  оригинала цитату не меняет — переход показывает актуальную версию). */
export const replyPreviewSchema = z.object({
  id: z.uuid(),
  /** Автор оригинала; null — оригинал удалён бесследно и автор неизвестен. */
  author: userRefSchema.nullable(),
  /** Сниппет текста оригинала (серверное усечение); '' у чисто медийного. */
  text: z.string(),
  /** Частичная цитата (модель Telegram Replies 2.0): процитированный
   *  фрагмент вместо начала текста; null — цитата всего сообщения. */
  quoteText: z.string().nullable(),
  /** Вид вложения оригинала — подписи «Фото»/«Файл»/«Стикер» в цитате без текста. */
  attachmentKind: z.enum(['image', 'file', 'sticker']).nullable(),
  /** #288: мини-глиф оригинального СТИКЕРА в цитате (референс Telegram) —
   *  подписанный url содержимого файла + первый эмодзи пака. Опционально:
   *  толерантность к старым снапшотам и записям events-лога. */
  stickerUrl: z.string().nullable().optional(),
  stickerEmoji: z.string().nullable().optional(),
  /** #288: mime глифа (webm играет видео, остальное — img). */
  stickerMime: z.string().nullable().optional(),
  /** Оригинал удалён — цитата показывает «Сообщение удалено» (канон
   *  Telegram lng_deleted_message): удаление сильнее заморозки снапшота. */
  deleted: z.boolean(),
  /** Оригинал удалён БЕСЛЕДНО (obliterated, #163): якоря в ленте нет —
   *  клику по цитате некуда вести. deleted=true при obliterated=false —
   *  надгробие: цитата кликабельна и ведёт к пузырю «Сообщение удалено». */
  obliterated: z.boolean(),
});

export type ReplyPreview = z.infer<typeof replyPreviewSchema>;

/** Источник пересланного сообщения: атрибуция «Переслано от X» + переход
 *  к оригиналу (с проверкой прав на сервере). */
export const forwardedFromSchema = z.object({
  author: userRefSchema,
  conversationId: z.uuid(),
  messageId: z.uuid(),
  /** Оригинал жил в треде канала — переход целится в окно треда. */
  threadRootId: z.uuid().nullable(),
});

export type ForwardedFrom = z.infer<typeof forwardedFromSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  /** Порядковый номер в беседе (монотонный): курсор квитанций просмотров
   *  (POST /read { upToSeq } — seq самой новой видимой строки, #102 р.2). */
  seq: z.number().int().positive(),
  /** Ключ отправки клиента (= Idempotency-Key запроса; у копий пересылки —
   *  с суффиксом). Связка оптимистичного темпа с серверной записью: WS-эхо
   *  своей отправки заменяет темп на месте по этому полю, рефечи отличают
   *  подтверждённые записи от ещё летящих (#243). max 160 — с запасом на
   *  суффиксы копий (база ограничена 1–128 на сервере). */
  clientMessageId: z.string().min(1).max(160),
  author: userRefSchema,
  text: z.string(),
  replyToId: z.uuid().nullable(),
  /** Данные цитаты (снапшот); null — сообщение без ответа. */
  reply: replyPreviewSchema.nullable(),
  /** Треды ровно одного уровня: ответы ссылаются на корневое сообщение. */
  threadRootId: z.uuid().nullable(),
  threadRepliesCount: z.number().int().min(0),
  reactions: z.array(messageReactionSchema),
  attachments: z.array(messageAttachmentSchema),
  editedAt: z.iso.datetime().nullable(),
  /** Надгробие: сообщение удалено СО СЛЕДОМ (хоть один участник прочитал —
   *  правило определяет сервер по курсорам прочтения). text='', вложения и
   *  реакции очищены; UI рендерит placeholder «Сообщение удалено». */
  deletedAt: z.iso.datetime().nullable(),
  /** Закреплено в беседе (лента закрепов — GET /pins; флаг для реакции
   *  ленты/меню без загрузки списка). */
  pinned: z.boolean(),
  /** Пересланное: источник для атрибуции и перехода; null — своё. */
  forwardedFrom: forwardedFromSchema.nullable(),
  /** Метка прочтения: момент, когда сообщение прочитал ПЕРВЫЙ из участников
   *  (модель Битрикс24/Telegram, #102; в direct — единственный собеседник,
   *  семантика прежняя). null — отправлено, ещё никем не прочитано. Правка
   *  сбрасывает метку до перечитывания — «повторный пуш прочитавшим» (#41). */
  readAt: z.iso.datetime().nullable(),
  /** Прочитавшие сообщение на момент выдачи (сортировка по времени прочтения).
   *  Только для СВОИХ сообщений (приватность: прочитавших видит лишь автор);
   *  у чужих — пустой массив. Правка исключает прочитавшего до перечитывания. */
  readBy: z.array(userRefSchema),
  /** «Важное сообщение» (#100): пробивается через mute/DND верхним ярусом
   *  уведомлений; само по себе действий получателя не требует. */
  urgent: z.boolean(),
  /** Упомянутые @Имя (userId, зафиксированы при отправке, #100): fanout
   *  уведомлений без разбора текста; правка упоминания не добавляет. */
  mentionedUserIds: z.array(z.uuid()),
  /** Превью ПЕРВОЙ ссылки сообщения (#212): карточка-цитата ПОД текстом
   *  (домен/заголовок/описание/картинка; канон Telegram/Slack — превью
   *  ниже сообщения), дозревает фоном (WS chat.link_preview_ready).
   *  null — ссылок нет/надгробие; pending — скелетон; failed/blocked —
   *  заглушка из домена. */
  linkPreview: z.lazy(() => linkPreviewSchema).nullable(),
  /** Вид сообщения (#380): у блока перехода правка запрещена. Optional —
   *  толерантность к старым записям events-лога и кэшам до #380
   *  (`undefined` читается как `text`). */
  kind: chatMessageKindSchema.optional(),
  /** Данные блока (по виду); null — обычное сообщение или payload не разобрался. */
  block: chatMessageBlockSchema.nullable().optional(),
  createdAt: z.iso.datetime(),
});

export type ChatMessage = z.infer<typeof messageSchema>;

/** Ответ поиска сообщений по id (окно перехода, #380): отсутствующие и
 *  недоступные молча выпадают (без оракула). */
export const messageLookupResultSchema = z.object({ items: z.array(messageSchema) });
export type MessageLookupResult = z.infer<typeof messageLookupResultSchema>;

/** Снимок превью ссылки (#212): в DTO сообщения и в payload WS-события
 *  chat.link_preview_ready (общая схема). */
export const linkPreviewSchema = z.object({
  /** Домен-источник карточки (заглушка при bot-block/нет OG). */
  siteName: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** Подписная ссылка og:image-деривата (SILO, ≤640px webp) — ОТНОСИТЕЛЬНЫЙ
   *  путь `/api/v1/files/…?exp=&sig=` (тот же формат, что у вложений);
   *  null — без картинки (текстовая карточка). */
  imageUrl: z.string().nullable(),
  status: z.enum(['pending', 'ready', 'failed', 'blocked']),
});
export type LinkPreview = z.infer<typeof linkPreviewSchema>;

/** Закрепленное сообщение: снапшот обязателен — закреп может жить вне
 *  загруженного окна ленты (пин-бар и секция «Закреплённые» рендерят из него). */
export const messagePinSchema = z.object({
  message: messageSchema,
  pinnedBy: userRefSchema,
  pinnedAt: z.iso.datetime(),
});

export type MessagePin = z.infer<typeof messagePinSchema>;

/** Роль участника беседы (фундамент прав, #91 — исследование Bitrix24
 *  im.dialog: role owner/manager/member + матрица manage_* прав). Проверка
 *  прав — на API-гуардах (I8); UI лишь прячет недоступное по вычисленным
 *  permissions в ответе (модель Bitrix24 restrictions). */
export const conversationMemberRoleSchema = z.enum(['owner', 'admin', 'member']);
export type ConversationMemberRole = z.infer<typeof conversationMemberRoleSchema>;

/** Матрица прав беседы (фундамент, #91): минимальная роль для действия.
 *  changeInfo покрывает название + аватарку + цвет (Bitrix24 manage_ui —
 *  одним правом). Дефолты сервера: changeInfo=admin, addMembers=member,
 *  removeMembers=admin, post=member, manageSettings=owner. */
export const conversationPermissionsSchema = z.object({
  changeInfo: conversationMemberRoleSchema,
  addMembers: conversationMemberRoleSchema,
  removeMembers: conversationMemberRoleSchema,
  post: conversationMemberRoleSchema,
  manageSettings: conversationMemberRoleSchema,
});
export type ConversationPermissions = z.infer<typeof conversationPermissionsSchema>;

/** Черновик ТЕКУЩЕГО пользователя в беседе (контракт синхронизации, #91 —
 *  исследование tdesktop/Telegram Core: клиент пишет локально мгновенно,
 *  PUT — debounce 1000 мс после паузы набора + flush при переключении беседы
 *  и visibilitychange:hidden; сервер ГАСИТ черновик в транзакции отправки
 *  сообщения (урок tdesktop#26236 «воскресающих» черновиков); revision —
 *  last-write-wins между устройствами владельца. */
export const conversationDraftSchema = z.object({
  text: z.string().max(4000),
  revision: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});
export type ConversationDraft = z.infer<typeof conversationDraftSchema>;

/** Тело сохранения черновика (PUT /chat/conversations/:id/draft, #91):
 *  пустой текст = очистка; revision опционален (сервер монотонно растит). */
export const saveConversationDraftBodySchema = z.object({
  text: z.string().max(4000),
  revision: z.number().int().min(0).optional(),
});
export type SaveConversationDraftBody = z.infer<typeof saveConversationDraftBodySchema>;

/** Квитанция просмотров (POST /chat/conversations/:id/read, #102 раунд 2):
 *  просмотр = факт видимости вьюпортом всей строки (раунд 3) — клиент шлёт seq
 *  самой новой видимой строки (троттл ~500 мс при движении вперёд); сервер
 *  двигает watermark (GREATEST, кламп к last_seq) и эмитит chat.message_read.
 *  threadRootId — квитанция ИЗ ТРЕДА: дополнительно двигает watermark трэда
 *  наблюдателя (точка «есть новые» на посте гаснет), watermark беседы — как
 *  обычно («увидел где угодно = просмотрено»). */
export const readConversationBodySchema = z.object({
  upToSeq: z.number().int().positive(),
  threadRootId: z.uuid().optional(),
});
export type ReadConversationBody = z.infer<typeof readConversationBodySchema>;

export const readConversationResultSchema = z.object({
  /** Клэмпнутый upToSeq запроса (min(upToSeq, last_seq)); НЕ текущий
   *  watermark участника — при отставшей квитанции может быть меньше его. */
  upToSeq: z.number().int().nonnegative(),
});
export type ReadConversationResult = z.infer<typeof readConversationResultSchema>;

export const conversationListItemSchema = z.object({
  id: z.uuid(),
  type: conversationTypeSchema,
  /** Для direct — вычисляется из имён участников на клиенте/сервере. */
  title: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  /** Роль текущего пользователя в беседе (бэкенд #58): UI прячет недоступное,
   *  сравнивая myRole с матрицей permissions (модель Bitrix24 restrictions). */
  myRole: conversationMemberRoleSchema,
  /** Матрица прав беседы (минимальные роли; дефолты — см. схему матрицы). */
  permissions: conversationPermissionsSchema,
  /** Читатель без членства (#433): решающий видит чат задачи, но отправка и
   *  правки ему недоступны — интерфейс прячет композер. */
  readOnly: z.boolean().optional(),
  /** Черновик текущего пользователя (null — нет): метка «Черновик: …» и
   *  подъём беседы в списке на других устройствах; локальный черновик
   *  клиента первичнее (мгновенный), серверный — догоняет (контракт #91). */
  draft: conversationDraftSchema.nullable(),
  /** Видимость группы/канала (null у direct/task/letter): закрытый — вне
   *  общего списка, открытый — вступить может любой (реф Bitrix24, #91). */
  visibility: z.enum(['closed', 'open']).nullable(),
  /** Описание беседы (карточка «О чате», создание чата #91); null — нет. */
  description: z.string().nullable(),
  project: projectRefSchema.nullable(),
  /** Чат задачи (type=task): привязка к задаче для вкладки «Чаты задач». */
  task: taskRefSchema.nullable(),
  /** Чат письма (type=letter): привязка к письму; участники — только
   *  внутренние сотрудники (обсуждение наружу не уходит). */
  letter: letterRefSchema.nullable(),
  membersPreview: z.array(userRefSchema),
  /** Всего участников беседы, СЧИТЯ зрителя (кнопка «N участников» в
   *  топбаре и счётчик подзаголовка, #186; membersPreview — урезанный
   *  превью-набор, его длина счётчиком не является). */
  membersCount: z.number().int().min(0),
  lastMessage: messageSchema.nullable(),
  /** Момент активности для сортировки списка (ISO): сообщения ИЛИ новая
   *  звезда в «Избранном» (GREATEST(last_message_at, последняя закладка) —
   *  звезда поднимает чат наверх, как новое сообщение, #215); null —
   *  активности не было. Превью остаётся lastMessage. */
  lastActivityAt: z.string().nullable(),
  unreadCount: z.number().int().min(0),
  /** Watermark прочтения ТЕКУЩЕГО пользователя в беседе (см. ниже): якорь
   *  «открыть на первом непрочитанном» (seq > myLastReadSeq, раунд 3). */
  myLastReadSeq: z.number().int().nonnegative(),
  /** Закреплена (контекстное меню беседы, реф Битрикс24): закреплённые — сверху. */
  pinned: z.boolean(),
  /** Звук выключен (уведомления копятся без звука; глиф на строке). */
  muted: z.boolean(),
  /** «Посмотреть позже»: счётчик непрочитанных скрыт до НОВОГО сообщения. */
  snoozed: z.boolean(),
});

export type ConversationListItem = z.infer<typeof conversationListItemSchema>;

/** Правка состояния беседы из контекстного меню (ПКМ, реф Битрикс24):
 *  закрепить/звук/«посмотреть позже»/скрыть из списка. */
export const conversationUpdateBodySchema = z
  .object({
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
    snoozed: z.boolean().optional(),
    /** Скрыть из списка (архив беседы: история сохраняется, I15). Активность
     *  (отправка/пересылка) и открытие из поиска людей раскрывают беседу
     *  (модель Битрикс24, #103). */
    hidden: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type ConversationUpdateBody = z.infer<typeof conversationUpdateBodySchema>;

/** Переименование беседы (PATCH /chat/conversations/:id/info, #186): право
 *  changeInfo матрицы (дефолт — владелец и модераторы); переименовываются
 *  группы и каналы — у direct/task/letter название производное. */
export const conversationInfoBodySchema = z.object({
  title: z.string().trim().min(1).max(128),
});
export type ConversationInfoBody = z.infer<typeof conversationInfoBodySchema>;

/** Участник беседы (GET /chat/conversations/:id/members, #186): профиль из
 *  справочника (read-порт, I3) + роль из таблицы участия. */
export const conversationMemberSchema = z.object({
  user: userRefSchema,
  role: conversationMemberRoleSchema,
  joinedAt: z.iso.datetime(),
});
export type ConversationMember = z.infer<typeof conversationMemberSchema>;

export const listConversationMembersQuerySchema = cursorQuerySchema.extend({
  search: z.string().trim().min(1).max(128).optional(),
});
export type ListConversationMembersQuery = z.infer<typeof listConversationMembersQuerySchema>;

/** Добавление участников (POST /chat/conversations/:id/members, #186): право
 *  addMembers матрицы (дефолт — любой участник); только группы и каналы —
 *  состав direct/task/letter фиксирован сущностью (#195); уже состоящих и
 *  неизвестных сервер молча пропускает, лимит участников беседы (200) —
 *  точный (перечёт в tx под блокировкой строки). */
export const addConversationMembersBodySchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(100),
});
export type AddConversationMembersBody = z.infer<typeof addConversationMembersBodySchema>;

/** Смена роли участника (PATCH /chat/conversations/:id/members/:userId,
 *  #186): право manageSettings (дефолт — владелец); только группы и каналы
 *  (#195); роль owner этой дорогой не назначается и не снимается (владелец
 *  один — создатель беседы). */
export const updateConversationMemberBodySchema = z.object({
  role: z.enum(['admin', 'member']),
});
export type UpdateConversationMemberBody = z.infer<typeof updateConversationMemberBodySchema>;

/** Создание группового чата/канала (#91, референс окна «Создание чата»
 *  Bitrix24): участники + настройки + матрица прав (частичная — остальные
 *  значения ставит сервер дефолтами). Аватарка группы/канала — НЕ полем
 *  создания: загрузка файла отдельным эндпоинтом после старта MinIO (#57),
 *  право загрузки — changeInfo; до того беседа живёт с детерминированной
 *  цветовой заглушкой из инициалов (модель Telegram/Bitrix24).
 *  АВТОУДАЛЕНИЯ/TTL СООБЩЕНИЙ В КОНТРАКТЕ НЕТ (решение владельца 24.09.2026,
 *  #96): поле автоудаления удалено — логика в продукте не появится, и контракт
 *  не должен провоцировать бэкенд строить её. */
export const createConversationBodySchema = z.object({
  type: z.enum(['group', 'project_channel']),
  title: z.string().trim().min(1).max(128),
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(['closed', 'open']).optional(),
  /** Без создателя: сервер добавляет владельца первым участником (role=owner). */
  memberIds: z.array(z.uuid()).max(200).optional(),
  permissions: conversationPermissionsSchema.partial().optional(),
});
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;

export const listConversationsQuerySchema = cursorQuerySchema.extend({
  search: z.string().trim().min(1).max(128).optional(),
  /** Вкладка мессенджера (#252): chats — люди и каналы, entities — «Чаты
   *  задач и писем» (своя серверная пагинация); all — всё (пикеры). */
  scope: z.enum(['all', 'chats', 'entities']).default('all'),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

/** Сводка непрочитанных по вкладкам мессенджера
 *  (GET /chat/conversations/unread-summary): сумма непрочитанных СООБЩЕНИЙ,
 *  тот же предикат, что `unread_count` списка бесед (включая семантику
 *  тредов канала); скрытые и «посмотреть позже» беседы не входят. Отдельный
 *  агрегат, потому что список пагинирован и сумма по первой странице врёт. */
export const chatUnreadSummarySchema = z.object({
  /** Вкладка «Чаты»: люди, группы, каналы. */
  chats: z.number().int().min(0),
  /** Вкладка «Чаты задач и писем»: type=task/letter. */
  entities: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type ChatUnreadSummary = z.infer<typeof chatUnreadSummarySchema>;

export const listMessagesQuerySchema = cursorQuerySchema.extend({
  /** Тред канала: корневое сообщение + его ответы (ровно один уровень). */
  threadRootId: z.uuid().optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/** Отправка сообщения: в тред канала — с threadRootId (корень + ответы);
 *  ответ-цитата — replyToId; вложения — ids загруженных через
 *  POST /chat/attachments; стикер — stickerId (#143, отдельное
 *  стикер-сообщение без текста). Текст, вложения ИЛИ стикер обязательны
 *  (сообщение только с файлом/стикером — валидно, канон Telegram).
 *  attachmentRenames (#146): файл переименован в окне отправки уже ПОСЛЕ
 *  загрузки — имя применяется в транзакции отправки; ссылаться можно только
 *  на ids из attachmentIds. */
export const sendMessageBodySchema = z
  .object({
    /** Текст необязателен на входе (сообщение только с файлом/стикером —
     *  валидно, канон Telegram): отсутствие нормализуется в пустую строку,
     *  иначе refine ниже недостижим для этого сценария. */
    text: z.string().trim().max(4000).default(''),
    attachmentIds: z.array(z.uuid()).max(20).optional(),
    attachmentRenames: z.array(attachmentRenameSchema).max(20).optional(),
    /** Стикер из пака (доступного отправителю): сервер клеймит вложение
     *  kind='sticker' с метаданными пака (снапшот). */
    stickerId: z.uuid().optional(),
    replyToId: z.uuid().nullable().optional(),
    /** Частичная цитата: фрагмент текста оригинала, выделенный автором
     *  ответа (модель Telegram Replies 2.0); сервер усекает снапшот, а не
     *  найденный в отображаемом тексте оригинала фрагмент отбрасывает —
     *  ответ становится цитатой всего сообщения (#346). */
    quoteText: z.string().trim().max(1024).nullable().optional(),
    threadRootId: z.uuid().nullable().optional(),
    /** «Важное сообщение» (#100): прямые беседы и группы ≤20 участников;
     *  лимит на отправителя (по умолчанию 3/сутки) проверяет сервер. */
    urgent: z.boolean().optional(),
  })
  .refine(
    (v) => v.text.length > 0 || (v.attachmentIds?.length ?? 0) > 0 || v.stickerId !== undefined,
    {
      message: 'text or attachmentIds or stickerId required',
    },
  )
  // Переименование целится только в отправляемые вложения: иначе имя
  // «повисало» бы на чужой/непривязанной строке (граница прав #146).
  .refine(
    (v) => {
      const renames = v.attachmentRenames ?? [];
      if (renames.length === 0) return true;
      return (
        v.attachmentIds !== undefined &&
        new Set(renames.map((r) => r.id)).size === renames.length &&
        renames.every((r) => v.attachmentIds!.includes(r.id))
      );
    },
    {
      message: 'attachmentRenames must reference unique attachmentIds',
      path: ['attachmentRenames'],
    },
  );

export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

/** Правка сообщения (#188, без лимита давности — решение #41): текст плюс
 *  опционально полный итоговый состав вложений attachmentIds (порядок =
 *  sort_order; новые — привязываются, отсутствующие — открепляются;
 *  отсутствующее поле = состав не меняется — правка текста из композера)
 *  и переименования файлов. Текст или состав обязательны (сообщение только
 *  с файлами — валидно, канон отправки). */
export const editMessageBodySchema = z
  .object({
    text: z.string().trim().max(4000),
    attachmentIds: z.array(z.uuid()).max(20).optional(),
    attachmentRenames: z.array(attachmentRenameSchema).max(20).optional(),
  })
  .refine((v) => v.text.length > 0 || (v.attachmentIds?.length ?? 0) > 0, {
    message: 'text or attachmentIds required',
  })
  // Дубликаты id недетерминировали бы sort_order (UPDATE … FROM ordinal).
  .refine(
    (v) => {
      const ids = v.attachmentIds;
      return ids === undefined || new Set(ids).size === ids.length;
    },
    {
      message: 'attachmentIds must be unique',
    },
  );

export type EditMessageBody = z.infer<typeof editMessageBodySchema>;

/** Пакетное удаление (лимит 100 — явный, как у Telegram; превышение —
 *  ошибка валидации, не молчаливое обрезание). */
export const batchDeleteMessagesBodySchema = z.object({
  messageIds: z.array(z.uuid()).min(1).max(100),
});

export type BatchDeleteMessagesBody = z.infer<typeof batchDeleteMessagesBodySchema>;

/** Результат пакетного удаления: какие исчезли бесследно (204-семантика)
 *  и какие стали надгробиями (прочитаны — след остаётся). */
export const batchDeleteMessagesResultSchema = z.object({
  removed: z.array(z.uuid()),
  tombstones: z.array(messageSchema),
});

export type BatchDeleteMessagesResult = z.infer<typeof batchDeleteMessagesResultSchema>;

/** Пересылка: серверные копии сообщений в целевую беседу (вложения
 *  переиспользуются по ссылке). Комментарий — отдельным сообщением ПЕРЕД
 *  блоком (канон Telegram ShareBox). threadRootId — цель внутри канала:
 *  тред конкретного поста; null/отсутствует — в ленту (новый корень). */
export const forwardMessagesBodySchema = z.object({
  sourceConversationId: z.uuid(),
  messageIds: z.array(z.uuid()).min(1).max(100),
  comment: z.string().trim().max(4000).optional(),
  threadRootId: z.uuid().nullable().optional(),
});

export type ForwardMessagesBody = z.infer<typeof forwardMessagesBodySchema>;

/** Состояние трэда для ТЕКУЩЕГО пользователя (раунд 3, «честная видимость
 *  уведомлений»: счётчик трэда и точку «есть новые» видит только наблюдатель).
 *  Наблюдатель = нажал «Следить», писал в трэде, отмечен @ или автор поста. */
export const threadStateSchema = z.object({
  threadRootId: z.uuid(),
  /** Я наблюдатель этого трэда (кнопка «Следить» в шапке окна треда). */
  watched: z.boolean(),
  /** Непрочитанные чужие ответы с моего watermark трэда (0 у не-наблюдателей). */
  unreadCount: z.number().int().min(0),
});
export type ThreadState = z.infer<typeof threadStateSchema>;

/** GET /chat/conversations/:id/threads/state — снимок состояний всех трэдов
 *  беседы, где текущий пользователь — наблюдатель (не пагинируется: объём
 *  ограничен числом трэдов беседы у одного пользователя). */
export const threadStateListSchema = z.object({
  items: z.array(threadStateSchema),
});
export type ThreadStateList = z.infer<typeof threadStateListSchema>;

/** POST /chat/conversations/:id/threads/:rootId/watch — toggle наблюдения
 *  (идемпотентный: повтор с тем же Idempotency-Key возвращает первый результат).
 *  Watching=false снимает наблюдение кнопкой (реплай/@ добавят снова). */
export const threadWatchResultSchema = z.object({
  watching: z.boolean(),
});
export type ThreadWatchResult = z.infer<typeof threadWatchResultSchema>;
