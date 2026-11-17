import type { AssistantMessage } from '@nodus/contracts';

import type { AssistantLiveRun } from './assistant-store.js';

/**
 * Лента = серверная история + живой буфер открытой сессии.
 *
 * Живой буфер нужен по двум причинам (I4, оптимистичный UI):
 * 1. Вопрос сотрудника виден МГНОВЕННО — до того, как история перезагрузится
 *    после POST (иначе модель «думает» раньше вопроса).
 * 2. Ответ печатается из потока до финальной строки в БД; когда сохранённая
 *    строка приходит, живой пузырь уступает ей по id.
 *
 * Дублей нет: серверный вопрос вытесняет синтетический по `userMessageId`,
 * серверный ответ — по `messageId`.
 */
export function mergeLiveMessage(
  messages: readonly AssistantMessage[],
  live: AssistantLiveRun | null,
  activeSessionId: string | null,
): AssistantMessage[] {
  if (!live || live.sessionId !== activeSessionId) return [...messages];
  // Временная строка оптимистичной отправки уступает живому пузырю (он
  // старше и тот же текст): иначе между ответом POST и рефетчем истории
  // в ленте на миг два одинаковых вопроса.
  const withoutLive = messages.filter(
    (message) => message.id !== live.messageId && !message.id.startsWith('pending-'),
  );
  const createdAt = new Date(live.startedAt).toISOString();
  const placeholder: AssistantMessage = {
    id: live.messageId ?? `live-${live.runId}`,
    role: 'assistant',
    text: live.text,
    reasoning: live.reasoning || null,
    createdAt,
    runId: live.runId,
    streaming: live.status === 'running',
    errorCode: live.errorCode,
    toolCalls: live.tools,
  };
  const hasServerUser = messages.some((message) => message.id === live.userMessageId);
  const optimisticUser: AssistantMessage | null =
    !hasServerUser && live.userText.trim()
      ? {
          // id — серверный, как только POST его вернул: иначе пузырь вопроса
          // перемонтируется при рефетче истории (наблюдаемое мигание окна,
          // 18.11.2026). До ответа POST — стабильный клиентский хвост.
          id: live.userMessageId ?? `live-user-${live.runId}`,
          role: 'user',
          text: live.userText,
          reasoning: null,
          createdAt,
          runId: live.runId,
          streaming: false,
          errorCode: null,
          toolCalls: [],
        }
      : null;
  return [...withoutLive, ...(optimisticUser ? [optimisticUser] : []), placeholder];
}
