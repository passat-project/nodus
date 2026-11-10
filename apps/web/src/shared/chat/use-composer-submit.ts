import { useRef } from 'react';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { useChatDrafts, type ChatDraft } from './chat-drafts.js';
import { focusComposer } from './composer-focus.js';
import { toWireText, type DraftMention } from './composer-mention-registry.js';
import { messageLimitState, type ComposerSubmit } from './composer-submit.js';
import { useForwardMessages } from './forward-mutation.js';
import { useForwardPending, type ForwardPending } from './forward-pending.js';
import { useScrollEndStore } from './scroll-end-store.js';

/** Догон ленты (вердикт 24.09): одиночная своя отправка — ПЛАВНО; быстрая
 *  серия — мгновенно (smooth на каждую пачку = «дёргание», раунд 3). */
export function useRequestScrollEnd(focusId: string): () => void {
  const lastSendAt = useRef(0);
  return function requestScrollEnd(): void {
    const now = Date.now();
    const burst = now - lastSendAt.current < 1500;
    lastSendAt.current = now;
    useScrollEndStore.getState().request(focusId, burst ? 'auto' : 'smooth');
  };
}

/**
 * Сабмит композера (chat-composer.tsx): гейты кнопки (лимит по wire-длине,
 * загрузки, пересылка), видимость отправки и сам submit — правка, пересылка
 * с комментарием или обычная отправка через хост.
 */
export function useComposerSubmit({
  focusId,
  draft,
  draftMentions,
  pending,
  onSubmit,
  requestScrollEnd,
}: {
  focusId: string;
  draft: ChatDraft;
  draftMentions: DraftMention[];
  pending: ForwardPending | null;
  onSubmit: (submit: ComposerSubmit) => void;
  requestScrollEnd: () => void;
}) {
  const forward = useForwardMessages();
  const text = draft.text;
  // Загрузка ИЛИ серверная обработка держит отправку (#717): в фазе
  // «Обработка…» attachmentIds ещё нет — без гейта текст ушёл бы без файла.
  const uploading = draft.attachments.some(
    (a) => a.status === 'uploading' || a.status === 'processing',
  );
  const readyAttachments = draft.attachments.filter((a) => a.status === 'ready' && a.attachment);
  const hasContent = text.trim().length > 0 || readyAttachments.length > 0;
  // Превалидация лимита (раунд 3): счётчик у черты, отправка заблокирована,
  // текст НЕ теряется (остаётся в поле/черновике — серверного 422 нет).
  // Лимит/счётчик — по WIRE-длине (отправляемое = измеряемое, ревью #228):
  // display короче wire на накладные расходы токенов (~46 симв./чип) —
  // display-замер пропускал бы к отправке 422.
  const limit = messageLimitState(toWireText(text, draftMentions).length);
  // Пересылка отправляется и без комментария (блок сам по себе ценен);
  // правка — только с непустым текстом; загрузка вложений держит обе.
  const canSubmit = draft.edit
    ? text.trim().length > 0 && !limit.over
    : pending // пересылка без вложений — загрузка трей не блокирует
      ? !limit.over
      : hasContent && !uploading && !limit.over;
  // Telegram: отправки НЕТ до первого символа (на её месте микрофон);
  // бар пересылки кнопку показывает (комментарий опционален).
  const sendVisible = draft.edit ? text.trim().length > 0 : hasContent || pending !== null;

  function submit() {
    if (!canSubmit) return;
    if (draft.edit) {
      // Правка НЕ переводится на сабмит-чистку (#248): правки нет в очереди
      // отправки, RTT визуально мал, а риск сломать восстановление режима
      // выше выгоды — черновик/режим чистит хост по onSuccess (#124).
      onSubmit({
        text: toWireText(text, draftMentions).trim(),
        attachments: [],
        reply: null,
        edit: draft.edit,
      });
      return;
    }
    if (pending) {
      const target = pending;
      const comment = toWireText(text, draftMentions).trim();
      // Комментарий уходит из поля на сабмите (#248, модель Telegram):
      // мгновенно, не по подтверждению; ошибка пересылки вернёт его в поле.
      useChatDrafts.getState().setText(focusId, '');
      forward.mutate(
        {
          targetId: target.conversationId,
          body: {
            sourceConversationId: target.sourceConversationId,
            messageIds: target.messageIds,
            comment: comment || undefined,
            threadRootId: target.threadRootId,
          },
        },
        {
          onSuccess: () => {
            useForwardPending.getState().clear(focusId);
            toast.success(ui.chat.forwardDone);
            // Догон и фокус приёмника — ПОСЛЕ успеха (раунд 3): раньше нонс
            // ставился до ответа сервера и гасился о невставшие сообщения.
            useScrollEndStore.getState().request(focusId, 'smooth');
            focusComposer(focusId);
          },
          onError: () => {
            // Возврат комментария в поле (#248; #124 — упавшая пересылка не
            // теряет текст): пустое поле — с чипами (wire→display), занятое
            // следующим набором — prepend плоским текстом.
            useChatDrafts.getState().restoreFailedSend(focusId, {
              wireText: comment,
              reply: null,
              urgent: false,
              attachments: [],
            });
          },
        },
      );
      return;
    }
    onSubmit({
      text: toWireText(text, draftMentions).trim(),
      attachments: readyAttachments,
      reply: draft.reply,
      edit: null,
      // Молния (#177): флаги летят с отправкой; сброс — очисткой черновика
      // на сабмите (обёртка мутации, #248). Ошибка 409 политики — состав
      // возвращается в поле onError, молния на месте.
      urgent: draft.urgent,
    });
    // Своё сообщение видно с любой позиции скролла (вердикт 24.09).
    // Черновик чистит обёртка мутации на сабмите (#248, модель Telegram):
    // поле пусто мгновенно, статус отправки — в ленте (темп); ошибка вернёт
    // текст в поле (#124).
    requestScrollEnd();
  }

  return { limit, sendVisible, submit };
}
