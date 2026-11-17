import type { AssistantAction, AssistantActionBatch, AssistantMessage } from '@nodus/contracts';

/**
 * Состояние пачки карточек для ленты (#916): группировка по сообщению-ходу и
 * снимок «решение N из M». Вынесено из `assistant-feed.tsx` (I5): чистые
 * функции — без разметки, их видно в тестах и модели.
 */

/** Карточки одного хода — по сообщению-владельцу: пачка решается вместе. */
export function groupActionsByMessage(
  actions: readonly AssistantAction[],
): [string, AssistantAction[]][] {
  const groups = new Map<string, AssistantAction[]>();
  for (const action of actions) {
    const key = action.messageId ?? 'live';
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }
  return [...groups.entries()];
}

/**
 * Состояние пачки для полосы над карточками: серверный снимок (если история
 * уже перечитана) либо расчёт по карточкам живого потока — иначе полоса не
 * появилась бы до конца прогона. `null` — серверной пачки нет и сообщение не
 * печатается: это байпас (действия уже исполнены) или история до появления
 * пачек; «Выполнить все» для такой группы вернуло бы 404 (валидация 18.11.2026).
 */
export function batchFor(
  messageId: string,
  actions: readonly AssistantAction[],
  messages: readonly AssistantMessage[],
): AssistantActionBatch | null {
  const message = messages.find((entry) => entry.id === messageId);
  if (message?.actionBatch) return message.actionBatch;
  if (!message?.streaming) return null;
  const pending = actions.filter(
    (action) => action.state === 'proposed' || action.state === 'executing',
  ).length;
  if (pending === 0) return null;
  return {
    state: 'open',
    total: actions.length,
    decided: actions.length - pending,
    pending,
  };
}
