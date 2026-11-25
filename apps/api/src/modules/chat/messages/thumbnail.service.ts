import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { CHAT_EVENTS } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/ports/file-storage.port.js';
import { MAX_ATTACHMENT_BYTES } from './attachments.constants.js';
import { AttachmentsRepository, type AttachmentRow } from './attachments.repository.js';
import { buildVideoPoster } from './video-thumbnail.js';

/** Максимальная сторона превью (WebP): плитки ленты ≤480 дизайн-px ×DPR —
 *  800 хватает и для галерей, и для лайтбокс-подложки (#150). */
export const THUMB_MAX_EDGE = 800;

/** Потолок пикселей декодирования (security #221, декомпрессионная бомба:
 * сжатый до сотен КБ монотонный PNG разворачивается в гигабайты RAM).
 * Синхронный путь (в HTTP-запросе загрузки) — жёсткий 4096² (≈50 МБ
 * декода, единообразно с link-preview). Фоновый воркер — дефолт sharp
 * 16383² (паритет main: фото серийных камер 100–200 Мп не теряют превью;
 * путь изолирован очередью concurrency 2, не в HTTP). */
export const SYNC_PIXEL_LIMIT = 4096 * 4096;
export const WORKER_PIXEL_LIMIT = 16383 * 16383;

/** EXIF-ориентации 5–8 — поворот на 90°: физические width/height в файле
 *  нужно менять местами, чтобы совпасть с тем, что видит браузер. */
function orientedSize(
  width: number,
  height: number,
  orientation?: number,
): { width: number; height: number } {
  return orientation !== undefined && orientation >= 5
    ? { width: height, height: width }
    : { width, height };
}

async function readAll(stream: Readable, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
    if (total > cap) throw new Error(`original exceeds ${cap} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Генерация серверных превью вложений-изображений (#150, ADR-0015):
 * оригинал из хранилища → sharp (метаданные авторитетно, EXIF-поворот) →
 * WebP max-edge 800 → дериват в хранилище (FileObject с derivedFrom —
 * «превью такого-то файла») → thumbFileId в message_attachments. Плитки
 * ленты и подложка лайтбокса грузят превью (десятки КБ) вместо оригиналов
 * (мегабайты через туннель).
 *
 * Контракт отказоустойчивости: превью ОПЦИОНАЛЬНО — не-изображение,
 * недекодируемый файл или исчезнувший объект оставляют thumbFileId=null
 * (клиент держит заглушку, оригинал грузит только лайтбокс).
 * БРОСОК хранилища/БД выходит наружу — job ретраится (3 попытки), после
 * исчерпания превью остаётся null. Идемпотентно: готовое превью — no-op.
 * Вызывается из BullMQ-воркера и backfill-скрипта, а также СИНХРОННО из
 * HTTP-запроса загрузки (≤ SYNC_PREVIEW_BYTES, #221) — там пиксельный
 * потолок SYNC_PIXEL_LIMIT жёстче воркерного (декомпрессионные бомбы).
 */
@Injectable()
export class ThumbnailService {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly repository: AttachmentsRepository,
    private readonly signedUrls: SignedUrlService,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ThumbnailService.name);
  }

  /** pixelLimit — потолок пикселей декодирования (security #221): синхронный
   *  вызов из HTTP передаёт жёсткий SYNC_PIXEL_LIMIT, воркер — просторный
   *  WORKER_PIXEL_LIMIT; превышение — тихий отказ (превью опционально). */
  async generateFor(attachmentId: string, pixelLimit: number = WORKER_PIXEL_LIMIT): Promise<void> {
    const attachment = await this.repository.findAnyById(attachmentId);
    if (!attachment || attachment.thumbFileId) return;
    if (attachment.kind === 'video') {
      await this.generateVideoPoster(attachment);
      return;
    }
    if (attachment.kind !== 'image') return;

    const original = await this.storage.get(attachment.fileId);
    if (!original) return;
    const input = await readAll(original.stream, MAX_ATTACHMENT_BYTES);

    try {
      const meta = await sharp(input, { failOn: 'none', limitInputPixels: pixelLimit }).metadata();
      if (!meta.width || !meta.height) {
        this.logger.warn({ attachmentId }, 'Превью: изображение без габаритов');
        return;
      }
      const size = orientedSize(meta.width, meta.height, meta.orientation);

      const thumb = await sharp(input, { failOn: 'none', limitInputPixels: pixelLimit })
        .rotate() // авто-поворот по EXIF — превью всегда в экспонируемой ориентации
        .resize({
          width: THUMB_MAX_EDGE,
          height: THUMB_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();

      const { fileId: thumbFileId } = await this.storage.save(
        {
          ownerId: attachment.ownerId,
          name: `${attachment.name}.preview.webp`,
          mime: 'image/webp',
          size: thumb.byteLength,
          derivedFrom: attachment.fileId,
        },
        Readable.from(thumb),
      );
      const won = await this.repository.markThumbnail(attachmentId, {
        thumbFileId,
        width: size.width,
        height: size.height,
      });
      if (!won) {
        // Гонка двойной генерации (#156): победил другой прогон — свой
        // дериват сносим, сирот не оставляем.
        await this.storage.remove([thumbFileId]).catch(() => undefined);
        this.logger.info({ attachmentId }, 'Превью: проиграл гонку фиксации, дериват удалён');
        return;
      }
      await this.emitPreviewReady(attachmentId, thumbFileId);
    } catch (error) {
      // Недекодируемый файл/сбой декодера: превью опционально — тихий отказ
      // без ретраев (job не должен падать трижды на мусоре).
      this.logger.warn({ attachmentId, err: error }, 'Превью: декодирование не удалось');
    }
  }

  /** Постер видео (#250): ffprobe (габариты с поворотом, длительность) +
   *  кадр-WebP ≤800. Контракт отказоустойчивости тот же, что у фото: сбой
   *  превью — тихий отказ, строка живёт на клиентских метаданных; бросок
   *  хранилища/БД — наружу (job ретраится). */
  private async generateVideoPoster(attachment: AttachmentRow): Promise<void> {
    const original = await this.storage.get(attachment.fileId);
    if (!original) return;
    let savedThumbId: string | null = null;
    try {
      const result = await buildVideoPoster(original.stream);
      if (!result) {
        this.logger.warn(
          { attachmentId: attachment.id },
          'Постер видео: не удалось прочитать ролик',
        );
        return;
      }
      const { fileId: thumbFileId } = await this.storage.save(
        {
          ownerId: attachment.ownerId,
          name: `${attachment.name}.preview.webp`,
          mime: 'image/webp',
          size: result.poster.byteLength,
          derivedFrom: attachment.fileId,
        },
        Readable.from(result.poster),
      );
      savedThumbId = thumbFileId;
      const won = await this.repository.markThumbnail(attachment.id, {
        thumbFileId,
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
      });
      if (!won) {
        await this.storage.remove([thumbFileId]).catch(() => undefined);
        savedThumbId = null;
        this.logger.info(
          { attachmentId: attachment.id },
          'Постер видео: проиграл гонку фиксации, дериват удалён',
        );
        return;
      }
      savedThumbId = null; // зафиксирован в строке — сиротой не считается
      await this.emitPreviewReady(attachment.id, thumbFileId, {
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
      });
    } catch (error) {
      // Бросок после save (БД/событие) не должен оставлять дериват-сироту.
      if (savedThumbId) await this.storage.remove([savedThumbId]).catch(() => undefined);
      this.logger.warn(
        { attachmentId: attachment.id, err: error },
        'Постер видео: генерация не удалась (превью опционально)',
      );
    }
  }

  /** Фоновое превью отправленного сообщения готово (#221): клиенты получают
   *  chat.attachment_preview_ready и патчат плитку на месте — получатели не
   *  грузят оригинал в ленту, пока очередь догенерировала миниатюру. Событие
   *  — только для уже отправленных (неотправленное DTO заберёт сам); сбой
   *  эвента не рушит генерацию (превью в строке уже зафиксировано). */
  private async emitPreviewReady(
    attachmentId: string,
    thumbFileId: string,
    meta?: { width: number | null; height: number | null; durationMs: number | null },
  ): Promise<void> {
    try {
      const conversationId = await this.repository.findConversationIdOf(attachmentId);
      if (!conversationId) return;
      const thumbnailUrl = this.signedUrls.fileContentUrl(thumbFileId);
      await this.txRunner.run((tx) =>
        this.eventBus.emit(tx, CHAT_EVENTS.ATTACHMENT_PREVIEW_READY, {
          conversationId,
          attachmentId,
          thumbnailUrl,
          ...(meta ?? {}),
        }),
      );
    } catch (error) {
      this.logger.warn(
        { attachmentId, err: error },
        'Событие готовности превью не отправлено (клиент догонит рефетчем)',
      );
    }
  }
}
