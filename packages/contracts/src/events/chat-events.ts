import { z } from 'zod';

import { messageSchema, linkPreviewSchema } from '../chat/chat.schemas.js';

/**
 * Каталог доменных событий модуля chat (I9: каждое событие — в `events`
 * через outbox; префикс = модуль-владелец в ед. числе; каталог только
 * расширяется — api-conventions.md). Payload минимальный и клиентски видим
 * (будущий WS-fanout рассылает те же события — секретов и внутренних полей
 * в payload не держать).
 */
export const CHAT_EVENTS = {
  CONVERSATION_CREATED: 'chat.conversation_created',
  CONVERSATION_UPDATED: 'chat.conversation_updated',
  MEMBER_ADDED: 'chat.member_added',
  MEMBER_REMOVED: 'chat.member_removed',
  MEMBER_ROLE_CHANGED: 'chat.member_role_changed',
  MESSAGE_SENT: 'chat.message_sent',
  MESSAGE_EDITED: 'chat.message_edited',
  MESSAGE_DELETED: 'chat.message_deleted',
  MESSAGE_READ: 'chat.message_read',
  MESSAGE_PINNED: 'chat.message_pinned',
  MESSAGE_UNPINNED: 'chat.message_unpinned',
  REACTION_ADDED: 'chat.reaction_added',
  REACTION_REMOVED: 'chat.reaction_removed',
  THREAD_CREATED: 'chat.thread_created',
  ATTACHMENT_UPDATED: 'chat.attachment_updated',
  STICKER_PACK_CREATED: 'chat.sticker_pack_created',
  STICKER_PACK_UPDATED: 'chat.sticker_pack_updated',
  STICKER_PACK_DELETED: 'chat.sticker_pack_deleted',
  STICKER_ADDED: 'chat.sticker_added',
  STICKER_REMOVED: 'chat.sticker_removed',
  STICKER_PACK_INSTALLED: 'chat.sticker_pack_installed',
  STICKER_PACK_UNINSTALLED: 'chat.sticker_pack_uninstalled',
  // Избранное (#171): личное состояние (как прочитанность) — без рассылки
  // другим участникам; gateway маршрутизирует в user-комнату владельца.
  FAVORITE_ADDED: 'chat.favorite_added',
  FAVORITE_REMOVED: 'chat.favorite_removed',
  FAVORITE_UPDATED: 'chat.favorite_updated',
  // Превью ссылки дозрело фоном (#212): конвейер BullMQ закончил — карточка
  // применяется в кэш ленты на месте (скелетон → fade-in, без рефетча).
  LINK_PREVIEW_READY: 'chat.link_preview_ready',
  // Серверная миниатюра вложения-изображения готова (#221): фоновая очередь
  // догенерила превью после отправки — клиенты патчат thumbnailUrl на месте
  // (плитка-заглушка → превью, без рефетча и без загрузки оригинала).
  ATTACHMENT_PREVIEW_READY: 'chat.attachment_preview_ready',
} as const;

export const chatConversationCreatedPayloadSchema = z.object({
  conversationId: z.uuid(),
  type: z.enum(['direct', 'group', 'project_channel', 'task', 'letter']),
  title: z.string().nullable(),
  createdBy: z.uuid(),
  /** Первичные участники (включая создателя). */
  memberIds: z.array(z.uuid()),
});
export type ChatConversationCreatedPayload = z.infer<typeof chatConversationCreatedPayloadSchema>;

/** Название или аватар беседы изменились (#186: переименование кликом и
 *  аватарка, право changeInfo): клиенты рефечат список/беседу — подписанные
 *  URL аватара нестабильны, локальный патч по событию не делаем. */
export const chatConversationUpdatedPayloadSchema = z.object({
  conversationId: z.uuid(),
  /** Новое название (null — сброса нет: у переименовываемых типов оно
   *  обязательное); отсутствует, когда менялся только аватар. */
  title: z.string().nullable().optional(),
  /** Аватар установлен/сменён/убран — поле к рефечу. */
  avatarChanged: z.boolean().optional(),
  /** Ссылка беседы письма изменилась (тема или номер после регистрации,
   *  #55): клиенты рефечат список — подпись «Чатов задач и писем». */
  letterChanged: z.boolean().optional(),
});
export type ChatConversationUpdatedPayload = z.infer<typeof chatConversationUpdatedPayloadSchema>;

/** Вложение обновилось новой версией файла (сохранение ONLYOFFICE, #182):
 * подписка chat на file.version_created → мост с conversationId для
 * маршрутизации gateway'ем в комнату беседы; клиенты рефечат ленту и
 * файловые запросы (сессия просмотрщика) — версия подхватывается без F5. */
export const chatAttachmentUpdatedPayloadSchema = z.object({
  conversationId: z.uuid(),
  fileId: z.uuid(),
  version: z.number().int().min(2),
  size: z.number().int().min(0),
});
export type ChatAttachmentUpdatedPayload = z.infer<typeof chatAttachmentUpdatedPayloadSchema>;

/** Серверная миниатюра вложения готова (#221): очередь догенерила превью уже
 *  отправленного сообщения — маршрутизация в комнату беседы, клиенты патчат
 *  thumbnailUrl вложения в кэше ленты на месте (заглушка → превью). */
export const chatAttachmentPreviewReadyPayloadSchema = z.object({
  conversationId: z.uuid(),
  attachmentId: z.uuid(),
  /** Подписанная ссылка превью (TTL подписи 24 ч; дальнейшие рефечи ленты
   *  обновляют её сами). */
  thumbnailUrl: z.string().min(1),
  /** Авторитетные серверные метаданные (#250): клиент патчит плитку видео/
   *  фотографии без рефетча; optional — старые события их не несут. */
  width: z.number().int().min(0).nullable().optional(),
  height: z.number().int().min(0).nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
});
export type ChatAttachmentPreviewReadyPayload = z.infer<
  typeof chatAttachmentPreviewReadyPayloadSchema
>;

export const chatMemberAddedPayloadSchema = z.object({
  conversationId: z.uuid(),
  userIds: z.array(z.uuid()),
  role: z.enum(['owner', 'admin', 'member']),
});
export type ChatMemberAddedPayload = z.infer<typeof chatMemberAddedPayloadSchema>;

/** Участник исключён из беседы (#186, право removeMembers): удалённому
 *  беседа исчезает из списка, остальным — рефеч счётчика и панели. */
export const chatMemberRemovedPayloadSchema = z.object({
  conversationId: z.uuid(),
  userId: z.uuid(),
  actorId: z.uuid(),
});
export type ChatMemberRemovedPayload = z.infer<typeof chatMemberRemovedPayloadSchema>;

/** Роль участника сменилась (модератор ⇄ участник, #186, право manageSettings). */
export const chatMemberRoleChangedPayloadSchema = z.object({
  conversationId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(['admin', 'member']),
  actorId: z.uuid(),
});
export type ChatMemberRoleChangedPayload = z.infer<typeof chatMemberRoleChangedPayloadSchema>;

export const chatMessageSentPayloadSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  /** Порядковый номер в беседе (курсор подписчиков: seq > lastSeen). */
  seq: z.number().int().min(1),
  authorId: z.uuid(),
  /** Ответ в треде — корень треда; null — корневое сообщение ленты. */
  threadRootId: z.uuid().nullable(),
  /** Копия пересылки (атрибуция — в сообщении, не в событии). */
  forwarded: z.boolean(),
  /** «Важное сообщение» (#100): ярус urgent получателям (direct/группы ≤20). */
  urgent: z.boolean(),
  /** Упомянутые @Имя userId (снапшот момента отправки, #100): fanout
   *  уведомлений модулю notifications без разбора текста (I3). */
  mentionedUserIds: z.array(z.uuid()),
  /** Полный DTO нового сообщения (раунд 3, «буря рефечей»): живые клиенты
   *  применяют его в кэш ЛОКАЛЬНО по seq (канон Telegram: событие несёт
   *  сообщение; дыра в seq/правка/удаление — рефеч). Поле заполнено всегда;
   *  optional — толерантность к старым записям events-лога. */
  message: messageSchema.optional(),
});
export type ChatMessageSentPayload = z.infer<typeof chatMessageSentPayloadSchema>;

export const chatMessageEditedPayloadSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  editedAt: z.iso.datetime(),
  /** Правящий автор (уведомление «сообщение отредактировано», #189). */
  authorId: z.uuid(),
  /** Новый текст (превью уведомления; правка всегда текстовая). */
  text: z.string(),
  /** Порядковый номер правимого сообщения (гашение уведомления по watermark). */
  seq: z.number().int().min(1),
  /** Упомянутые в НОВОЙ версии (снапшот, #239): fanout дифф-уведомлений
   *  модулю notifications без разбора текста (I3). Optional — толерантность
   *  к старым записям events-лога (до #239). */
  mentionedUserIds: z.array(z.uuid()).optional(),
  /** ЛИЧНЫЕ тэги за всю историю сообщения ДО правки (без разворота
   *  «Все»): первый личный тэг получает chat.mention; убрали-вернули
   *  того же — не дёргаем (#239). */
  previousMentionedUserIds: z.array(z.uuid()).optional(),
  /** В истории сообщения был broadcast @Все (#239): глушит повторные
   *  broadcast-пинги правок, но НЕ первый личный тэг (вердикт 10.10). */
  previousMentionedAll: z.boolean().optional(),
  /** Личные тэги НОВОЙ версии (без «Все», без разворота, #239). */
  directMentionedUserIds: z.array(z.uuid()).optional(),
});
export type ChatMessageEditedPayload = z.infer<typeof chatMessageEditedPayloadSchema>;

export const chatMessageDeletedPayloadSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  /** true — бесследно (исчезло из выдач); false — надгробие. */
  obliterated: z.boolean(),
});
export type ChatMessageDeletedPayload = z.infer<typeof chatMessageDeletedPayloadSchema>;

/** Курсор прочтения участника продвинутся (якорь догрузки read-галочек). */
export const chatMessageReadPayloadSchema = z.object({
  conversationId: z.uuid(),
  userId: z.uuid(),
  upToSeq: z.number().int().min(0),
  readAt: z.iso.datetime(),
});
export type ChatMessageReadPayload = z.infer<typeof chatMessageReadPayloadSchema>;

export const chatMessagePinnedPayloadSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  pinnedBy: z.uuid(),
});
export type ChatMessagePinnedPayload = z.infer<typeof chatMessagePinnedPayloadSchema>;

export const chatMessageUnpinnedPayloadSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  unpinnedBy: z.uuid(),
});
export type ChatMessageUnpinnedPayload = z.infer<typeof chatMessageUnpinnedPayloadSchema>;

export const chatReactionPayloadSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  emoji: z.string().min(1),
  userId: z.uuid(),
});
export type ChatReactionPayload = z.infer<typeof chatReactionPayloadSchema>;

export const chatThreadCreatedPayloadSchema = z.object({
  conversationId: z.uuid(),
  /** Корневое сообщение, вокруг которого возник тред. */
  threadRootId: z.uuid(),
  /** Первый ответ, создавший тред. */
  messageId: z.uuid(),
});
export type ChatThreadCreatedPayload = z.infer<typeof chatThreadCreatedPayloadSchema>;

/** Адресаты событий содержимого пака (#318): у пикера пака видят те же, кто
 *  видит пак. Корпоративный — все сотрудники (gateway шлёт в общую комнату
 *  аутентифицированных сокетов, `audience` пуст); личный — владелец и
 *  установившие его «себе» (user-комнаты из `audience`). `audience` клиенту
 *  не доставляется — gateway вырезает его до emit (#318, #328). */
const stickerPackAudienceShape = {
  scope: z.enum(['corporate', 'personal']),
  audience: z.array(z.uuid()),
};

/** Стикер-паки (#143): payload минимальный и клиентски видим. Изменения пака
 *  (переименование, состав) — одно UPDATED-событие; стикер-сообщение rides
 *  на обычном chat.message_sent (вложение kind='sticker' несёт метаданные). */
export const chatStickerPackPayloadSchema = z.object({
  packId: z.uuid(),
  title: z.string().min(1).max(64),
  /** Инициатор (создатель/редактор/установивший). */
  actorId: z.uuid(),
  ...stickerPackAudienceShape,
});
export type ChatStickerPackPayload = z.infer<typeof chatStickerPackPayloadSchema>;

/** Установка/снятие пака пользователем (личная коллекция): меняется только
 *  его набор «моих» паков — gateway шлёт в user-комнату `userId`. */
export const chatStickerPackInstallPayloadSchema = z.object({
  packId: z.uuid(),
  userId: z.uuid(),
});
export type ChatStickerPackInstallPayload = z.infer<typeof chatStickerPackInstallPayloadSchema>;

/** Пополнение пака стикером (инкрементальная точка для живых пикеров). */
export const chatStickerAddedPayloadSchema = z.object({
  packId: z.uuid(),
  stickerId: z.uuid(),
  actorId: z.uuid(),
  ...stickerPackAudienceShape,
});
export type ChatStickerAddedPayload = z.infer<typeof chatStickerAddedPayloadSchema>;

/** Избранное (#171): payload несёт userId владельца — gateway шлёт событие
 *  ТОЛЬКО в его user-комнату (личное состояние, другим участникам не виден;
 *  conversationId — для точечных инвалидаций вкладки панели беседы). */
export const chatFavoriteAddedPayloadSchema = z.object({
  userId: z.uuid(),
  conversationId: z.uuid(),
  messageId: z.uuid(),
});
export type ChatFavoriteAddedPayload = z.infer<typeof chatFavoriteAddedPayloadSchema>;

export const chatFavoriteRemovedPayloadSchema = z.object({
  userId: z.uuid(),
  conversationId: z.uuid(),
  messageId: z.uuid(),
});
export type ChatFavoriteRemovedPayload = z.infer<typeof chatFavoriteRemovedPayloadSchema>;

/** Метки закладки изменились (правка карточки, #171). */
export const chatFavoriteUpdatedPayloadSchema = z.object({
  userId: z.uuid(),
  conversationId: z.uuid(),
  messageId: z.uuid(),
});
export type ChatFavoriteUpdatedPayload = z.infer<typeof chatFavoriteUpdatedPayloadSchema>;

/** Превью ссылки готово (#212): карточка первого URL сообщения дозрела
 *  фоном (кэш link_previews) — payload несёт готовый DTO-снимок превью,
 *  клиенты патчат сообщение на месте без рефетча. Комната — беседы.
 *  Схема превью — общая с DTO сообщения (chat.schemas.linkPreviewSchema). */
export const chatLinkPreviewReadyPayloadSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  /** Первая ссылка сообщения (превью — только первая, канон TG/Slack). */
  url: z.string(),
  preview: linkPreviewSchema,
});
export type ChatLinkPreviewReadyPayload = z.infer<typeof chatLinkPreviewReadyPayloadSchema>;
