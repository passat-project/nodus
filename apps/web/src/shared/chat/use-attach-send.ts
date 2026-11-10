import { useEffect, useState, type RefObject } from 'react';
import { ui } from '@nodus/contracts';

import { messageLimitState, type ComposerSubmit } from './composer-submit.js';
import {
  EMPTY_DRAFT,
  useChatDrafts,
  type ChatDraft,
  type PendingAttachment,
} from './chat-drafts.js';
import { cancelUpload, removePending } from './composer-files.js';
import type { DraftMention } from './composer-mention-registry.js';
import { cancelMessageEdit } from './message-edit.js';
import { useAttachSendDialog } from './dialog-stores.js';
import type { ReplyDraft } from './reply-snapshot.js';
import { useScrollEndStore } from './scroll-end-store.js';
import { submitForScope } from './submit-registry.js';
import { captionWireOf } from './use-caption-mentions.js';

/**
 * Отправка/отмена окна вложений (#144/#248): снапшоты состава и ответа на
 * полёте, гейт кнопки, автозакрытие при опустевшем составе, возврат подписи
 * черновиком. Разметка окна — attach-send-dialog.tsx.
 */
export function useAttachSend({
  scope,
  draft,
  caption,
  close,
  mentionListRef,
}: {
  scope: string | null;
  draft: ChatDraft;
  caption: string;
  close: () => void;
  mentionListRef: RefObject<DraftMention[]>;
}) {
  // Строки на полёте отправки (#248): хост чистит черновик на САБМИТЕ — окно
  // держит снятый ДО отправки состав (кнопка нажата, отмена выключена) до
  // исхода; на ошибке мутация возвращает вложения в черновик и строки снова
  // живые (файлы и подпись не теряются, повтор возможен, #144).
  const [flightItems, setFlightItems] = useState<PendingAttachment[] | null>(null);
  const items = flightItems ?? draft.attachments;
  // Плашка ответа на полёте (#288): тот же снапшот-паттерн, что у строк —
  // черновик чистится сабмитом, цитата держится до исхода и не мигает.
  const [flightReply, setFlightReply] = useState<ReplyDraft | null>(null);
  const shownReply = flightReply ?? draft.reply;
  // Режим правки (#188): окно редактирует существующее сообщение — текст и
  // состав; «Сохранить» = PATCH с полным составом, отмена не трогает сообщение.
  const editMode = draft.edit !== null;
  const [sending, setSending] = useState(false);

  // Отправка встала (хост очистил черновик на сабмите, #248) или вложения
  // сняты все до одной — окно закрывается само. Снятие последней строки =
  // отмена: подпись возвращается черновиком в композер (валидатор #144:
  // текст не должен теряться); на пути отправки подпись съедена сообщением.
  // В режиме ПРАВКИ (#188) пустой состав — легальное состояние (сообщение с
  // одним текстом): окно не закрывается, edit сбрасывается только сохранением.
  useEffect(() => {
    if (scope && items.length === 0 && !editMode) {
      if (!sending) {
        // Возврат неотправленной подписи — wire-текстом (#239: чипы живы).
        const leftover = captionWireOf(mentionListRef);
        if (leftover) useChatDrafts.getState().restoreFromWire(scope, leftover);
      }
      setSending(false);
      close();
    }
  }, [scope, items.length, editMode, sending, close, mentionListRef]);

  const uploading = items.some((item) => item.status === 'uploading');
  // Тело принято, ответа ещё нет (#717): id вложения не выдан — отправлять
  // нельзя, но это уже не «загрузка», а серверная обработка.
  const processing = items.some((item) => item.status === 'processing');
  const errored = items.some((item) => item.status === 'error');
  // Лимит — по WIRE-длине (отправляемое = измеряемое, канон композера #228).
  const limit = messageLimitState(captionWireOf(mentionListRef).length);
  const readyCount = items.filter((item) => item.status === 'ready').length;
  const canSend =
    (editMode ? caption.trim().length > 0 || readyCount > 0 : items.length > 0) &&
    !uploading &&
    !processing &&
    !errored &&
    !limit.over &&
    !sending;
  // Почему кнопка «Отправить» неактивна (#717): «обработка» — ожидание
  // сервера, а не загрузка, и подсказка это называет.
  const sendHint = processing
    ? ui.chat.attachWaitProcessing
    : uploading
      ? ui.chat.attachWaitUpload
      : undefined;

  /** Отмена (Esc/«Отмена»): правка — сообщение не тронуто (исходные строки
   *  отвязаны только локально, новые загрузки сняты, текст композера
   *  восстановлен); отправка — загрузки сняты, готовые объекты удалены,
   *  подпись возвращается черновиком в композер (канон Telegram). */
  function cancelAll() {
    // В полёте отправки отмена выключена (валидатор #144): DELETE готовых
    // вложений при уходящем сообщении ломал бы отправку.
    if (!scope || sending) return;
    if (draft.edit) {
      cancelMessageEdit(scope);
      close();
      return;
    }
    // Возврат подписи черновику — WIRE-текстом через restoreFromWire (#239):
    // чипы упоминаний восстанавливаются в реестр композера, не теряются.
    const wire = captionWireOf(mentionListRef);
    if (wire) useChatDrafts.getState().restoreFromWire(scope, wire);
    const current = (useChatDrafts.getState().drafts[scope] ?? EMPTY_DRAFT).attachments;
    for (const item of current) {
      if (item.status === 'uploading') cancelUpload(scope, item.localId);
      else removePending(scope, item.localId);
    }
    useChatDrafts.getState().clearAttachments(scope);
    close();
  }

  async function send() {
    if (!scope || !canSend) return;
    const payload: ComposerSubmit = {
      // Wire-текст (#239): чипы подписи уходят токенами @[имя](user:id).
      text: captionWireOf(mentionListRef).trim(),
      attachments: items,
      reply: draft.reply,
      edit: draft.edit,
      editComposition: editMode,
    };
    const promise = submitForScope(scope, payload);
    if (!promise) return;
    // Состав снимается ДО первого рендера после сабмита (#248): черновик
    // чистится синхронно внутри submitForScope — без снапшота строки
    // мигнули бы пустыми на полёте.
    setFlightItems(items);
    setFlightReply(draft.reply);
    setSending(true);
    if (!editMode) {
      // Своё сообщение видно с любой позиции скролла (вердикт 24.09); правка
      // сообщения на месте скролл не двигает.
      useScrollEndStore.getState().request(scope, 'smooth');
    }
    try {
      await promise;
      // Подпись съедена сообщением: в поле через закрывающий эффект она не
      // возвращается (тот возвращает только подпись ОТМЕНЁННОЙ отправки).
      useAttachSendDialog.getState().setCaption('');
    } catch {
      // Тост сетевой ошибки — от мутации хоста; окно остаётся открытым:
      // вложения и ответ восстановлены в черновик onError (#248), подпись
      // жива — повтор возможен (#144).
    } finally {
      setFlightItems(null);
      setFlightReply(null);
      setSending(false);
    }
  }

  return {
    items,
    shownReply,
    editMode,
    sending,
    uploading,
    processing,
    sendHint,
    limit,
    canSend,
    cancelAll,
    send,
  };
}
