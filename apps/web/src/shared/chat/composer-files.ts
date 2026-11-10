import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../api-client.js';
import { EMPTY_DRAFT, useChatDrafts, type PendingAttachment } from './chat-drafts.js';
import { useAttachSendDialog } from './dialog-stores.js';
import { toWireText } from './composer-mention-registry.js';
import { uploadAttachment, validateFiles, type UploadHandle } from './upload-attachment.js';

/**
 * Оркестрация загрузок композера (A1, #87): приём файлов (скрепка/paste/drop)
 * → валидация ДО старта (лимиты — вердикт 24.09) → карточки в трее черновика
 * → загрузка с прогрессом → status ready. Модульные реестры handle/file:
 * загрузка переживает ремоунт композера (смена беседы — канон Telegram
 * «загрузка продолжается в фоне»), retry после ошибки без повторного выбора.
 */

const handles = new Map<string, UploadHandle>();
const sourceFiles = new Map<string, File>();

/** Порог показа второй фазы (#717): ответ сервера у малых файлов почти
 *  мгновенный — «Обработка…» не должна мигать на доли секунды. */
export const PROCESSING_HINT_MS = 350;

export function addFiles(draftKey: string, incoming: File[]): void {
  if (incoming.length === 0) return;
  const store = useChatDrafts.getState();
  const current = store.drafts[draftKey] ?? EMPTY_DRAFT;
  const { accepted, issue } = validateFiles(incoming, current.attachments.length);
  if (issue === 'too-large') toast.error(ui.chat.attachTooLarge);
  if (issue === 'too-many') toast.error(ui.chat.attachTooMany);
  for (const file of accepted) startUpload(draftKey, file);
  // Принятые файлы видны ТОЛЬКО в окне отправки (#144): трея у строки ввода
  // больше нет — окно открывается на любое прикрепление (вердикт владельца).
  // Текст композера переезжает в подпись окна и НЕ дублируется онлайн в чате
  // (канон Telegram): вернётся в черновик отменой окна.
  if (accepted.length > 0) {
    const dialog = useAttachSendDialog.getState();
    if (!dialog.scope) {
      // Подпись окна получает WIRE-текст (#239): чипы упоминаний переезжают
      // с текстом — окно пересоберёт видимый текст + реестр из токенов.
      const d = useChatDrafts.getState().drafts[draftKey] ?? EMPTY_DRAFT;
      const initial = toWireText(d.text, d.mentions ?? []);
      dialog.open(draftKey, initial);
      if (initial) useChatDrafts.getState().setText(draftKey, '');
    }
  }
}

/** Замена вложения на месте (#188, меню строки «⋯» окна правки): новый файл
 *  загружается и встаёт на позицию старой строки; старая снимается — строка
 *  правимого сообщения отвязывается только локально (сервер увидит итоговый
 *  состав при сохранении правки), новая загрузка отменяется на сервере. */
export function replaceFile(draftKey: string, localId: string, file: File): void {
  const store = useChatDrafts.getState();
  const current = store.drafts[draftKey] ?? EMPTY_DRAFT;
  const index = current.attachments.findIndex((a) => a.localId === localId);
  const old = index >= 0 ? current.attachments[index] : undefined;
  if (!old) return;
  const { accepted, issue } = validateFiles([file], current.attachments.length - 1);
  if (issue === 'too-large') {
    toast.error(ui.chat.attachTooLarge);
    return;
  }
  if (accepted.length === 0) return;
  // Старая строка уходит до старта загрузки новой — «замена на месте» видна
  // сразу (позицию держит insertAttachment).
  const edit = current.edit;
  if (old.attachment && edit?.originalIds.includes(old.attachment.id)) {
    store.removeAttachment(draftKey, localId);
  } else if (old.status === 'uploading') {
    cancelUpload(draftKey, localId);
  } else {
    removePending(draftKey, localId);
  }
  startUploadAt(draftKey, index, file);
}

function startUploadAt(draftKey: string, index: number, file: File): void {
  const localId = crypto.randomUUID();
  const isImage = file.type.startsWith('image/');
  // Blob из буфера обмена не имеет имени — подписываем «Изображение»
  // (research-канон: не «image.png»).
  const fileName = file.name || (isImage ? ui.chat.quotePhoto : ui.chat.attachDocument);
  const pending: PendingAttachment = {
    localId,
    fileName,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    progress: 0,
    status: 'uploading',
    attachment: null,
    objectUrl: isImage ? URL.createObjectURL(file) : null,
  };
  sourceFiles.set(localId, file);
  useChatDrafts.getState().insertAttachment(draftKey, index, pending);
  runUpload(draftKey, localId, file);
}

function startUpload(draftKey: string, file: File): void {
  const current = (useChatDrafts.getState().drafts[draftKey] ?? EMPTY_DRAFT).attachments;
  startUploadAt(draftKey, current.length, file);
}

function runUpload(draftKey: string, localId: string, file: File): void {
  const store = () => useChatDrafts.getState();
  // Вторая фаза (#717): к 100% тело лишь принято сервером — дальше он стримит
  // файл в хранилище и пишет строки БД (80 МБ ≈ 2–3 с). Показываем её явно,
  // но только если она длится заметно (порог — см. PROCESSING_HINT_MS).
  let processingTimer = 0;
  const handle = uploadAttachment(file, (progress) => {
    store().patchAttachment(draftKey, localId, { progress });
    if (progress < 1 || processingTimer !== 0) return;
    processingTimer = window.setTimeout(() => {
      processingTimer = 0;
      store().patchAttachment(draftKey, localId, { status: 'processing' });
    }, PROCESSING_HINT_MS);
  });
  handles.set(localId, handle);
  handle.promise
    .then((attachment) => {
      window.clearTimeout(processingTimer);
      handles.delete(localId);
      // Строку сняли, пока сервер дорабатывал файл (отмена в фазе
      // «Обработка…»): вложение уже создано — освобождаем его, иначе оно
      // живёт невидимым до ленивой уборки (48 ч).
      if (!hasAttachmentRow(draftKey, localId)) {
        void api(`/chat/attachments/${attachment.id}`, { method: 'DELETE' }).catch(() => undefined);
        return;
      }
      store().patchAttachment(draftKey, localId, {
        status: 'ready',
        progress: 1,
        attachment,
      });
    })
    .catch((error: unknown) => {
      window.clearTimeout(processingTimer);
      handles.delete(localId);
      // Отмена — карточка уже убрана из трея, ошибка не нужна.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Сбой дочитки в фазе «Обработка…»: строки нет — пользователю о нём
      // сообщать нечем (отмена была намеренной).
      if (!hasAttachmentRow(draftKey, localId)) return;
      store().patchAttachment(draftKey, localId, { status: 'error' });
      toast.error(ui.chat.uploadFailed);
    });
}

function hasAttachmentRow(draftKey: string, localId: string): boolean {
  return (useChatDrafts.getState().drafts[draftKey] ?? EMPTY_DRAFT).attachments.some(
    (attachment) => attachment.localId === localId,
  );
}

export function cancelUpload(draftKey: string, localId: string): void {
  const item = (useChatDrafts.getState().drafts[draftKey] ?? EMPTY_DRAFT).attachments.find(
    (attachment) => attachment.localId === localId,
  );
  // Фаза «Обработка…» (#717): тело уже принято — abort не отменит работу
  // сервера, а только потеряет id готового вложения. Дочитываем ответ:
  // runUpload увидит снятую строку и удалит вложение на сервере.
  if (item?.status === 'uploading') handles.get(localId)?.cancel();
  handles.delete(localId);
  removePending(draftKey, localId);
}

export function retryUpload(draftKey: string, localId: string): void {
  const file = sourceFiles.get(localId);
  if (!file) return;
  useChatDrafts.getState().patchAttachment(draftKey, localId, {
    status: 'uploading',
    progress: 0,
  });
  runUpload(draftKey, localId, file);
}

export function removePending(draftKey: string, localId: string): void {
  const item = (useChatDrafts.getState().drafts[draftKey] ?? EMPTY_DRAFT).attachments.find(
    (attachment) => attachment.localId === localId,
  );
  sourceFiles.delete(localId);
  useChatDrafts.getState().removeAttachment(draftKey, localId);
  // Убранное из трея ГОТОВОЕ вложение освобождаем и на сервере (лимит 20
  // неотправленных, #57). Best-effort: сбой молча — брошенное уберёт
  // ленивая уборка сервера (48 ч).
  const attachmentId = item?.status === 'ready' ? item.attachment?.id : undefined;
  if (attachmentId) {
    void api(`/chat/attachments/${attachmentId}`, { method: 'DELETE' }).catch(() => undefined);
  }
}
