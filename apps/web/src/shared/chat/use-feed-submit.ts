import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@nodus/contracts';

import { toSendVars, type ComposerSubmit } from './composer-submit.js';
import { useEditMessage } from './edit-message-mutation.js';
import { startMessageEdit, toEditVars } from './message-edit.js';
import { useSendChatMessage, type SendChatVars } from './send-message.js';
import { registerScopeSubmit } from './submit-registry.js';

/** Последнее своё сообщение для ↑-правки: живое, не пересланное (#111) и
 *  подтверждённое сервером — летящий темп (seq=0) серверных команд не
 *  принимает (#243, как дизейбл «Редактировать» в меню). */
export function findLastMine(
  items: readonly ChatMessage[],
  meId: string | undefined,
): ChatMessage | undefined {
  return [...items]
    .reverse()
    .find((m) => m.author.id === meId && !m.deletedAt && !m.forwardedFrom && m.seq > 0);
}

/**
 * Общий протокол хостов ленты (conversation-pane, thread-pane, thread-feed,
 * notes-pane): отправка/правка из композера, регистрация submit окна
 * вложений по scope и ↑-правка последнего своего. threadRootId — хост треда
 * (ответы уходят в тред).
 */
export function feedSendVars(
  submit: ComposerSubmit,
  threadRootId: string | null,
  scope: string,
): SendChatVars {
  const vars = toSendVars(submit);
  // Лента канала (#1027): корневые посты не отвечают цитатами — ответ
  // живёт в треде. Даже поднятый из черновика reply не должен дать
  // невидимый пост (thread-feed рендерит только replyToId === null).
  const base = scope.startsWith('feed:')
    ? { ...vars, replyToId: null, quoteText: null, reply: null }
    : vars;
  return threadRootId ? { ...base, threadRootId } : base;
}

export function useFeedSubmit({
  conversationId,
  scope,
  threadRootId = null,
  items,
  meId,
}: {
  conversationId: string;
  /** draftKey композера хоста (`conversation:<id>` / `feed:<id>` / `thread:<rootId>`). */
  scope: string;
  threadRootId?: string | null;
  /** Лента ↑-правки (у канала — корни постов); без неё ↑-правки нет. */
  items?: readonly ChatMessage[];
  meId?: string;
}) {
  const send = useSendChatMessage(conversationId, scope);
  const edit = useEditMessage(conversationId, scope);

  function sendVars(submit: ComposerSubmit): SendChatVars {
    return feedSendVars(submit, threadRootId, scope);
  }

  function handleSubmit(submit: ComposerSubmit) {
    if (submit.edit) {
      const vars = toEditVars(submit);
      if (vars) edit.mutate(vars);
      return;
    }
    send.mutate(sendVars(submit));
  }

  // Окно отправки вложений (#144): глобальный диалог шлёт через хук хоста —
  // оптимистичность/reply/идемпотентность в одном месте; реестр жив, пока
  // панель смонтирована (режим выделения композер размонтирует, панель —
  // нет). send/edit — новый объект каждый рендер, реестру нужен стабильный
  // колбэк: ref, перерегистрация только по scope (и треду). Правка через окно
  // (#188) маршрутизируется сюда же (editComposition — состав вложений окна).
  const sendRef = useRef(send);
  sendRef.current = send;
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(
    () =>
      registerScopeSubmit(scope, (submit) => {
        if (submit.edit) {
          const vars = toEditVars(submit);
          return vars ? editRef.current.mutateAsync(vars) : Promise.resolve();
        }
        const vars = toSendVars(submit);
        return sendRef.current.mutateAsync(threadRootId ? { ...vars, threadRootId } : vars);
      }),
    [scope, threadRootId],
  );

  /** ↑ на пустом поле — правка последнего своего (шорткат Telegram). */
  function handleEditLast() {
    const message = items ? findLastMine(items, meId) : undefined;
    if (!message) return;
    startMessageEdit(scope, message);
  }

  return { handleSubmit, handleEditLast };
}
