import {
  attachmentPreviewKind,
  isPdfDerivativeCandidate,
  type MessageAttachment,
  type StickerMeta,
} from '@nodus/contracts';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';

/**
 * DTO вложения сообщения — общий для ленты (MessageDtoMapper), витрины
 * беседы и карточек «Избранного». Выделено из message-dto.mapper (I5).
 */

/** Строка вложения для DTO (стикер дополнительно несёт снапшот пака). */
export interface AttachmentDtoRow {
  id: string;
  fileId: string;
  name: string;
  size: number;
  mime: string;
  kind: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  thumbFileId: string | null;
  stickerMeta?: unknown;
}

/** Сборка DTO вложения: подписанный url, вид по kind, снапшот стикера. */
export function toAttachmentDto(
  a: AttachmentDtoRow,
  signedUrls: SignedUrlService,
): MessageAttachment {
  const stickerMeta = (a.stickerMeta as StickerMeta | null | undefined) ?? null;
  const previewKind = attachmentPreviewKind(a.name, a.mime);
  return {
    id: a.id,
    fileId: a.fileId,
    name: a.name,
    size: a.size,
    mime: a.mime,
    kind: a.kind as 'image' | 'video' | 'file' | 'sticker',
    url: signedUrls.fileContentUrl(a.fileId),
    // Серверное превью-дериват (#150); null — не сгенерировано.
    thumbnailUrl: a.thumbFileId ? signedUrls.fileContentUrl(a.thumbFileId) : null,
    // Маршрут просмотрщика и fallback-ссылка (#139): подпись детерминирована
    // от fileId — pdfUrl выдаётся КОНВЕРТИРУЕМЫМ офисным без похода в БД
    // (таблицы не конвертятся — спека), неготовая производная отвечает 404.
    previewKind,
    pdfUrl:
      previewKind === 'office' && isPdfDerivativeCandidate(a.name)
        ? signedUrls.fileDerivativeUrl(a.fileId, 'pdf')
        : null,
    width: a.width,
    height: a.height,
    durationMs: a.durationMs,
    ...(a.kind === 'sticker' && stickerMeta ? { sticker: stickerMeta } : {}),
  };
}
