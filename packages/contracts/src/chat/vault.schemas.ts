import { z } from 'zod';

import { userRefSchema } from '../directory/user-ref.schema.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';
import { conversationTypeSchema, linkPreviewSchema } from './chat.schemas.js';
import { messageAttachmentSchema } from './chat-attachment.schemas.js';

/** Витрина беседы (#211): серверные списки вложений и ссылок панели «О чате»
 *  + источники «Избранного». Списки читают БД (не загруженное окно ленты):
 *  вложение за пределами окна видно. Счётчики по типам — денормализованные
 *  (conversation_vault_stats, Δ в транзакциях состава), модель
 *  Telegram getSearchCounters / Битрикс24: чтение O(1), списки — keyset. */

/** Категория витрины (ревизия владельца 05.10 — модель Telegram): image —
 *  вложение kind='image', video/audio — файлы с mime video/*|audio/*,
 *  document — остальные файлы (стикеры — НЕ файлы пользователя, в витрине
 *  их нет; голосовые/GIF — с будущими фичами), link — URL из текста
 *  сообщения (write-time проекция message_links — извлечение при отправке/
 *  правке, не скан текстов на чтении). */
export const vaultItemTypeSchema = z.enum(['image', 'video', 'audio', 'document', 'link']);
export type VaultItemType = z.infer<typeof vaultItemTypeSchema>;

export const vaultCountsSchema = z.object({
  image: z.number().int().min(0),
  video: z.number().int().min(0),
  audio: z.number().int().min(0),
  document: z.number().int().min(0),
  link: z.number().int().min(0),
});
export type VaultCounts = z.infer<typeof vaultCountsSchema>;

/** Параметры счётчиков витрины: без скоупа — вся беседа (O(1) из stats),
 *  с threadRootId — скоуп треда (на лету). */
export const vaultCountsQuerySchema = z.object({
  threadRootId: z.uuid().optional(),
});
export type VaultCountsQuery = z.infer<typeof vaultCountsQuerySchema>;

/** Контекст источника элемента витрины: кто/когда отправил, где искать
 *  прыжок («показать в чате», jump-store #171). */
const vaultItemBaseSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  /** Ответ в треде канала: прыжок целится в окно треда. */
  threadRootId: z.uuid().nullable(),
  author: userRefSchema,
  /** Момент сообщения — ось витрины (новые сверху). */
  createdAt: z.iso.datetime(),
});

/** Элемент-вложение (image|video|audio|document): DTO вложения как в ленте. */
const vaultAttachmentBaseSchema = vaultItemBaseSchema.extend({
  attachment: messageAttachmentSchema,
});
export type VaultAttachmentItem = z.infer<typeof vaultAttachmentBaseSchema>;

export const vaultImageItemSchema = vaultAttachmentBaseSchema.extend({
  type: z.literal('image'),
});
export type VaultImageItem = z.infer<typeof vaultImageItemSchema>;

export const vaultVideoItemSchema = vaultAttachmentBaseSchema.extend({
  type: z.literal('video'),
});
export type VaultVideoItem = z.infer<typeof vaultVideoItemSchema>;

export const vaultAudioItemSchema = vaultAttachmentBaseSchema.extend({
  type: z.literal('audio'),
});
export type VaultAudioItem = z.infer<typeof vaultAudioItemSchema>;

export const vaultDocumentItemSchema = vaultAttachmentBaseSchema.extend({
  type: z.literal('document'),
});
export type VaultDocumentItem = z.infer<typeof vaultDocumentItemSchema>;

/** Элемент-ссылка: URL из текста сообщения (домен/путь клиент форматирует).
 *  preview — снимок кэша превью (#212): заголовок/домен/картинка, дозревает
 *  фоном; null — превью ещё нет (фолбэк — прежний вид строки). */
export const vaultLinkItemSchema = vaultItemBaseSchema.extend({
  type: z.literal('link'),
  url: z.string().min(1),
  preview: z.lazy(() => linkPreviewSchema).nullable(),
});
export type VaultLinkItem = z.infer<typeof vaultLinkItemSchema>;

export const vaultItemSchema = z.discriminatedUnion('type', [
  vaultImageItemSchema,
  vaultVideoItemSchema,
  vaultAudioItemSchema,
  vaultDocumentItemSchema,
  vaultLinkItemSchema,
]);
export type VaultItem = z.infer<typeof vaultItemSchema>;

export const listConversationVaultQuerySchema = cursorQuerySchema.extend({
  type: vaultItemTypeSchema,
  /** Скоуп треда (задел #42): в панели ревизии 05.10 скоуп-тоггла нет —
   *  витрина всегда вся беседа, параметр остаётся на будущее. */
  threadRootId: z.uuid().optional(),
});
export type ListConversationVaultQuery = z.infer<typeof listConversationVaultQuerySchema>;

/** Ответ витрины: страница элементов ОДНОГО типа + счётчики всех категорий
 *  (сводка панели; счётчики — денормализованные stats, «сколько всего»). */
export const conversationVaultPageSchema = z.object({
  items: z.array(vaultItemSchema),
  nextCursor: z.string().min(1).nullable(),
  counts: vaultCountsSchema,
});
export type ConversationVaultPage = z.infer<typeof conversationVaultPageSchema>;

/** Источники «Избранного» (Ф3, реф Telegram Saved): чаты, откуда прилетали
 *  звёзды. «Записи» — псевдоисточник (свои сообщения чата «Избранное»),
 *  отдельным полем. Счётчики категорий считают ЗВЁЗДЫ (вложения/ссылки
 *  карточек живых оригиналов) — НЕ stats беседы «Избранное»: избранное
 *  живёт в чужих беседах, денормализованная строка тут не подходит. */
export const favoriteSourceSchema = z.object({
  conversationId: z.uuid(),
  /** Подпись как у карточки: группа/канал — название, direct — имя
   *  собеседника; null у task/letter (фронт — i18n-строка). */
  title: z.string().nullable(),
  conversationType: conversationTypeSchema,
  /** Последняя закладка из этого чата — сортировка и подпись даты. */
  lastFavoritedAt: z.iso.datetime(),
  /** Живых закладок из этого чата. */
  count: z.number().int().min(1),
});
export type FavoriteSource = z.infer<typeof favoriteSourceSchema>;

export const favoriteSourcesSchema = z.object({
  /** Псевдоисточник «Записи»: свои сообщения чата «Избранное» (не звёзды). */
  notes: z.object({
    count: z.number().int().min(0),
    /** Последняя запись (живое сообщение автора = владелец чата). */
    lastAt: z.iso.datetime().nullable(),
  }),
  /** Живые источники-звёзды, новые закладки сверху. */
  sources: z.array(favoriteSourceSchema),
  /** Категории всего избранного (карточки звёзд: вложения по mime + ссылки). */
  counts: vaultCountsSchema,
});
export type FavoriteSources = z.infer<typeof favoriteSourcesSchema>;
