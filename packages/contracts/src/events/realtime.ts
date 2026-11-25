import { z } from 'zod';

import { presenceEntrySchema } from '../directory/presence.schemas.js';

/**
 * Realtime-контур (WS-gateway, #104): доменные события каталога
 * (api-conventions.md) пересылаются gateway'ем браузерам с теми же именами
 * в envelope; эфемерные события (typing, presence) живут только в WS-слое
 * и в каталог/БД не попадают.
 */

/** Redis Stream для фанута доменных событий из api (издатель →
 *  gateway-consumer). #100: стрим общий для всех доменных событий (был
 *  chat-only); переименован вместе со снятием фильтра в publisher. */
export const DOMAIN_EVENTS_STREAM = 'nodus:domain:events';

/**
 * Envelope WS-доставки (канон api-conventions.md): seq — глобальный
 * монотонный порядок события (`events.seq`); клиент хранит seq для будущей
 * догрузки пропущенного после reconnect (такой канал обязан, как gateway,
 * вырезать служебное `audience` из payload — #328). Клиент применяет события
 * ТОЛЬКО как сигнал к рефечу (сервер — единственная истина).
 *
 * actorId — автор действия (`events.actor_id`): сервер шлёт событие и актёру,
 * и клиент отличает эхо СВОЕЙ мутации (ключи уже перезапрошены по ответу —
 * второй раунд не нужен, #1051) от правки коллеги по той же задаче в те же
 * две секунды. Системные события (таймеры, почта, автоматика) автора не
 * имеют — поле отсутствует, клиент их не гасит.
 */
export const realtimeEnvelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
  seq: z.number().int().nonnegative(),
  ts: z.iso.datetime(),
  actorId: z.string().min(1).optional(),
});
export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>;

/**
 * Эфемерные события gateway (не доменные, не персистятся, память процесса):
 * typing — ввод текста участником беседы; presence — онлайн-статусы.
 */
export const REALTIME_EVENTS = {
  TYPING: 'chat.typing',
  PRESENCE_UPDATED: 'presence.updated',
  PRESENCE_SNAPSHOT: 'presence.snapshot',
} as const;

/** Клиент → gateway: «печатаю в беседе» (gateway троттлит ~3 с на пользователя).
 *  threadRootId — печать В ТРЕДЕ (раунд 3): индикатор живёт только в шапке
 *  окна треда, в список бесед и шапку канала не попадает. */
export const chatTypingEmitSchema = z.object({
  conversationId: z.uuid(),
  threadRootId: z.uuid().nullable().optional(),
});
export type ChatTypingEmit = z.infer<typeof chatTypingEmitSchema>;

/** Gateway → комната беседы: «участник печатает» (кроме сокетов автора).
 *  threadRootId ≠ null — печать в треде (получатель показывает в шапке окна
 *  треда; строчные превью и шапки бесед его игнорируют). */
export const chatTypingPayloadSchema = z.object({
  conversationId: z.uuid(),
  userId: z.uuid(),
  threadRootId: z.uuid().nullable().optional(),
});
export type ChatTypingPayload = z.infer<typeof chatTypingPayloadSchema>;

/** Gateway → всем: статус одного пользователя сменился. */
export const presenceUpdatedPayloadSchema = presenceEntrySchema;
export type PresenceUpdatedPayload = z.infer<typeof presenceUpdatedPayloadSchema>;

/** Gateway → новому сокету: снимок текущих онлайн-статусов. */
export const presenceSnapshotPayloadSchema = z.object({
  entries: z.array(presenceEntrySchema),
});
export type PresenceSnapshotPayload = z.infer<typeof presenceSnapshotPayloadSchema>;
