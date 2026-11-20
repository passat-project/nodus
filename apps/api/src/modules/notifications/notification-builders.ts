import { randomUUID } from 'node:crypto';
import { stripMentionTokens } from '@nodus/contracts';

import type { ChatConversationState } from '../chat/membership-reader.port.js';
import { PREVIEW_MAX, type NotificationInsert } from './notifications.repository.js';
import { resolveMessageNotifications, KIND_PRIORITY } from './priority-resolver.js';

/**
 * Чистые сборщики строк журнала из событий чата (без I/O и DI): событие +
 * состояние беседы → `NotificationInsert[]`. Сервис держит тонкие обёртки
 * (шов мокирования для хендлеров), логика и её тесты — здесь.
 */

/** Событие chat.message_sent в форме, нужной сборке (нормализует хендлер). */
export interface MessageSentInsertEvent {
  id: string;
  payload: {
    conversationId: string;
    messageId: string;
    seq: number;
    authorId: string;
    threadRootId: string | null;
    urgent: boolean;
    mentionedUserIds: string[];
    message?: { text?: string } | null;
  };
}

/** Событие chat.message_edited в форме, нужной сборке. */
export interface MessageEditedInsertEvent {
  id: string;
  payload: {
    conversationId: string;
    messageId: string;
    authorId: string;
    text: string;
    seq: number;
    /** Ответ треда — правка уходит только наблюдателям треда (#974). */
    threadRootId?: string | null;
    mentionedUserIds?: string[];
    previousMentionedUserIds?: string[];
    previousMentionedAll?: boolean;
    directMentionedUserIds?: string[];
  };
}

/** Превью строки ленты: обрезка по PREVIEW_MAX, пустой текст — null. */
function previewOf(text: string): string | null {
  return text.length > 0 ? text.slice(0, PREVIEW_MAX) : null;
}

/** Сборка строк журнала из события message_sent (вызывает хендлер). */
export function buildInsertsFromMessageEvent(
  event: MessageSentInsertEvent,
  state: ChatConversationState,
  threadWatcherIds: string[],
): NotificationInsert[] {
  const resolved = resolveMessageNotifications({
    conversationType: state.type,
    authorId: event.payload.authorId,
    urgent: event.payload.urgent,
    threadRootId: event.payload.threadRootId,
    mentionedUserIds: event.payload.mentionedUserIds,
    threadWatcherIds,
    members: state.members,
  });
  // Превью центра — БЕЗ токенов упоминаний (#224): стрип ДО обрезки —
  // slice по сырому тексту разрезал бы `@[Имя](user:…)` посередине и центр
  // показывал сырую разметку.
  const text = stripMentionTokens(event.payload.message?.text ?? '');
  return resolved.map((r) => ({
    id: randomUUID(),
    user_id: r.userId,
    priority: r.priority,
    kind: r.kind,
    source_type: 'conversation',
    source_id: event.payload.conversationId,
    source_seq: BigInt(event.payload.seq),
    actor_id: event.payload.authorId,
    preview: previewOf(text),
    urgent_text: r.priority === 'urgent' ? text : null,
    conversation_id: event.payload.conversationId,
    conversation_title: state.title,
    message_id: event.payload.messageId,
    thread_root_id: event.payload.threadRootId,
    event_id: event.id,
  }));
}

/** Сборка строк журнала из события message_edited (#189: правка прилетает
 *  в центр): всем членам беседы кроме редактора, низкий приоритет — счётчик
 *  в чате меняется, центр показывает то же. Высокий chat.mention — только
 *  ПЕРВЫЙ личный тэг (#239 + вердикт 10.10: замена @Все на прямой тэг —
 *  высший): человек упомянут в новой версии, никогда не тэгался лично
 *  (previousMentionedUserIds — личные тэги за историю) и (тэг личный,
 *  либо broadcast-«Все» добавлен этой правкой впервые). Повторные тэги
 *  и убрали-вернули того же — не дёргаем. */
export function buildInsertsFromEditedEvent(
  event: MessageEditedInsertEvent,
  state: ChatConversationState,
  threadWatcherIds: readonly string[] = [],
): NotificationInsert[] {
  const text = stripMentionTokens(event.payload.text ?? '');
  const mentioned = new Set(event.payload.mentionedUserIds ?? []);
  // Личные тэги за историю сообщения; broadcast-«Все» в истории отдельно.
  const everDirect = new Set(event.payload.previousMentionedUserIds ?? []);
  const hadAllBefore = event.payload.previousMentionedAll === true;
  const directNew = new Set(event.payload.directMentionedUserIds ?? []);
  const threadRootId = event.payload.threadRootId ?? null;
  const watchers = new Set(threadWatcherIds);
  // #974: правка ответа в обсуждении — только наблюдателям треда (иначе
  // правка в канале на 170 человек будила всех); правка ленты — как раньше,
  // всем членам беседы. Новый @упомянутый получает уведомление в любом случае.
  const audience = new Set<string>(
    threadRootId === null
      ? state.members.map((m) => m.userId)
      : state.members.filter((m) => watchers.has(m.userId)).map((m) => m.userId),
  );
  for (const userId of mentioned) audience.add(userId);
  return state.members
    .filter((m) => m.userId !== event.payload.authorId && audience.has(m.userId))
    .map((m) => {
      // Первый личный тэг — high (broadcast в истории его НЕ глушит,
      // вердикт владельца 10.10: «@Все → @Анна — Анне высший»); или
      // первый broadcast («Все» добавлен правкой, человека не тэгали).
      const newly =
        mentioned.has(m.userId) &&
        !everDirect.has(m.userId) &&
        (directNew.has(m.userId) || !hadAllBefore);
      const kind = newly ? 'chat.mention' : 'chat.message_edited';
      return {
        id: randomUUID(),
        user_id: m.userId,
        priority: KIND_PRIORITY[kind],
        kind,
        source_type: 'conversation',
        source_id: event.payload.conversationId,
        source_seq: BigInt(event.payload.seq),
        actor_id: event.payload.authorId,
        preview: previewOf(text),
        urgent_text: null,
        conversation_id: event.payload.conversationId,
        conversation_title: state.title,
        message_id: event.payload.messageId,
        thread_root_id: threadRootId,
        event_id: event.id,
      };
    });
}
