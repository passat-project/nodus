import type { MessageAttachment } from '@nodus/contracts';

import type { PendingAttachment } from './chat-drafts.js';

/** Картинки окна отправки (attach-send-dialog): локальные objectURL новых
 *  загрузок ИЛИ серверные превью строк правимого сообщения (#188); лайтбокс
 *  смотрит их же. */
export function attachPreviewImages(items: readonly PendingAttachment[]): MessageAttachment[] {
  return items.flatMap((item): MessageAttachment[] => {
    if (!item.mime.startsWith('image/')) return [];
    if (item.objectUrl) {
      return [
        {
          id: item.localId,
          fileId: item.attachment?.fileId ?? '',
          name: item.fileName,
          size: item.size,
          mime: item.mime,
          kind: 'image',
          url: item.objectUrl,
          thumbnailUrl: item.objectUrl,
          previewKind: 'image',
          pdfUrl: null,
          width: null,
          height: null,
        },
      ];
    }
    // Строка правимого сообщения: DTO с серверными url/превью.
    return item.attachment ? [{ ...item.attachment, name: item.fileName }] : [];
  });
}

/** У строки есть что показать в лайтбоксе изображений (локальный blob или
 *  серверное превью); видео в лайтбокс не попадает (#250). */
export function hasAttachPreview(item: PendingAttachment): boolean {
  if (!item.mime.startsWith('image/')) return false;
  return Boolean(item.objectUrl || item.attachment?.thumbnailUrl || item.attachment?.url);
}
