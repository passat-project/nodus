import { z } from 'zod';

import { userRefSchema } from '../directory/user-ref.schema.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';
import { conversationTypeSchema } from './chat.schemas.js';
import { messageAttachmentSchema } from './chat-attachment.schemas.js';

/** Избранное (#171): личные закладки-ссылки на сообщения. Модель «закладка,
 *  не копия» (вердикт владельца 02.10): карточка — живая ссылка на оригинал,
 *  правки отражаются, удаление оригинала гасит карточку в надгробие (#163).
 *  Звезда строго личная (как прочитанность): другие участники её не видят. */

/** Эмодзи-метка — личная (модель Telegram Premium, ревизия 04.10: метки =
 *  личные реакции, вид «эмодзи», без имён/заметок); НЕ справочник (I15 про
 *  бизнес-списки). Мультивыбор, видна только владельцу закладки. */
export const favoriteLabelEmoji = z.string().min(1).max(16);

/** Карточка избранного — единая точка решений (хосты: витрина «Избранного»
 *  и вкладка «Избранное» панели беседы). Контент живёт в оригинале: здесь —
 *  снапшот полей на момент выдачи (обновляется рефечем по событиям). */
export const favoriteCardSchema = z.object({
  /** Оригинал; он же ключ личной закладки (PK user × message). */
  messageId: z.uuid(),
  conversationId: z.uuid(),
  /** Подпись чата-источника («из …»): группы/каналы — название, direct —
   *  имя собеседника; null у task/letter (фронт подставит «Чат задачи»/«Чат
   *  письма» — i18n, I15). */
  conversationTitle: z.string().nullable(),
  conversationType: conversationTypeSchema,
  /** Оригинал — ответ в треде канала: прыжок целится в окно треда. */
  threadRootId: z.uuid().nullable(),
  /** Автор оригинала (у надгробия сохраняется — тон имени #180). */
  author: userRefSchema,
  /** Контент оригинала (правки отражаются — значение на момент выдачи). */
  text: z.string(),
  attachments: z.array(messageAttachmentSchema),
  editedAt: z.iso.datetime().nullable(),
  /** Оригинал удалён (#163): карточка гаснет в «Сообщение удалено». */
  deletedAt: z.iso.datetime().nullable(),
  /** Оригинал — «Важное» (#177): чип важного в витрине (ack-механика в
   *  витрине не рендерится — noReceipts). */
  urgent: z.boolean(),
  /** Бесследное удаление: якоря в ленте нет — «показать в чате» скрыто. */
  obliterated: z.boolean(),
  /** Момент оригинала (для группировки потока по дням). */
  createdAt: z.iso.datetime(),
  /** Личные эмодзи-метки владельца (мультивыбор, только ему видны). */
  labels: z.array(favoriteLabelEmoji).max(20),
  /** Момент закладки — ось потока «Избранного» и курсор списка. */
  favoritedAt: z.iso.datetime(),
});
export type FavoriteCard = z.infer<typeof favoriteCardSchema>;

export const listFavoritesQuerySchema = cursorQuerySchema.extend({
  /** Фильтр по чату-источнику (вкладка «Избранное» панели беседы). */
  conversationId: z.uuid().optional(),
  /** Фильтр по эмодзи-метке (чипы поиска витрины). */
  label: favoriteLabelEmoji.optional(),
  /** Поиск: подстрока в тексте оригинала. */
  q: z.string().trim().min(1).max(128).optional(),
});
export type ListFavoritesQuery = z.infer<typeof listFavoritesQuerySchema>;

/** Добавление (POST /chat/favorites): порядок массива = порядок цепочки
 *  в потоке «Избранного» (мультиселект сохраняет выделенный порядок). Уже
 *  состоящие в избранном идемпотентно пропускаются (PK user × message). */
export const addFavoritesBodySchema = z.object({
  messageIds: z.array(z.uuid()).min(1).max(100),
});
export type AddFavoritesBody = z.infer<typeof addFavoritesBodySchema>;

export const addFavoritesResultSchema = z.object({
  items: z.array(favoriteCardSchema),
});
export type AddFavoritesResult = z.infer<typeof addFavoritesResultSchema>;

/** Правка закладки (PATCH /chat/favorites/:messageId): личные эмодзи-метки
 *  (мультивыбор, весь состав массивом). */
export const updateFavoriteBodySchema = z.object({
  labels: z.array(favoriteLabelEmoji).max(20),
});
export type UpdateFavoriteBody = z.infer<typeof updateFavoriteBodySchema>;

/** Существующие эмодзи-метки пользователя (чипы поиска витрины): DISTINCT
 *  по всем закладкам. */
export const favoriteLabelListSchema = z.object({
  items: z.array(favoriteLabelEmoji),
});
export type FavoriteLabelList = z.infer<typeof favoriteLabelListSchema>;
