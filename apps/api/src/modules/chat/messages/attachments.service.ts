import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { attachmentPreviewKind, ErrorCode, type MessageAttachment } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/ports/file-storage.port.js';
import { safeFileName } from '../../../core/http/safe-file-name.js';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PENDING_ATTACHMENTS,
  SYNC_PREVIEW_BYTES,
} from './attachments.constants.js';
import { AttachmentsRepository, type AttachmentRow } from './attachments.repository.js';
import { ThumbnailQueue } from './thumbnail.queue.js';
import { SYNC_PIXEL_LIMIT, ThumbnailService } from './thumbnail.service.js';

/** Брошенные загрузки (закрыл композер, не отправил): строка + объект
 *  хранилища убираются попутно при следующей загрузке того же владельца. */
const STALE_UPLOAD_MS = 48 * 60 * 60 * 1000;

export interface UploadAttachmentInput {
  name: string;
  mime: string;
  size: number;
  width?: number | undefined;
  height?: number | undefined;
  /** Длительность видео от клиента (мс, #250); сервер перепроверит ffprobe. */
  durationMs?: number | undefined;
}

/**
 * Загрузка вложений чата (#57, Ф6): multipart-стрим через api в файловое
 * хранилище (порт FILE_STORAGE, ADR-0013) и строка message_attachments с
 * message_id IS NULL; привязка — одноразовая при отправке (claimAttachments).
 * Отдача — по подписанной ссылке files (url в DTO здесь и в маппере).
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly repository: AttachmentsRepository,
    private readonly signedUrls: SignedUrlService,
    private readonly thumbnailQueue: ThumbnailQueue,
    private readonly thumbnails: ThumbnailService,
    private readonly logger: PinoLogger,
    private readonly txRunner: TransactionRunner,
  ) {
    this.logger.setContext(AttachmentsService.name);
  }

  async upload(
    ownerId: string,
    input: UploadAttachmentInput,
    content: Readable,
  ): Promise<MessageAttachment> {
    if (!Number.isSafeInteger(input.size) || input.size < 0 || input.mime.length === 0) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid attachment metadata');
    }
    if (input.size > MAX_ATTACHMENT_BYTES) {
      throw new DomainException(
        ErrorCode.CHAT_ATTACHMENT_TOO_LARGE,
        'Attachment exceeds chat file limit',
        { maxBytes: MAX_ATTACHMENT_BYTES },
        413,
      );
    }
    await this.gcStaleUploads(ownerId);
    // Fast-fail до IO: заведомо полный трей не качаем в хранилище.
    // Авторитетная проверка — ниже, под локом в транзакции вставки.
    this.assertPendingBelowLimit(await this.repository.countUnclaimed(ownerId));

    // Имя — санитизируется один раз для объекта и строки (#250, security):
    // multipart-имя не ограничено, а DTO размножает его всем участникам.
    const name = safeFileName(input.name);
    const { fileId } = await this.storage.save(
      { ownerId, name, mime: input.mime, size: input.size },
      content,
    );
    // Вид — явный (контракт): галерея для изображений/видео, чип для остального.
    const kind = input.mime.startsWith('image/')
      ? 'image'
      : input.mime.startsWith('video/')
        ? 'video'
        : 'file';
    let row: AttachmentRow;
    try {
      // Лимит атомарно (аудит #317): лок владельца → перечёт → INSERT в одной
      // tx — параллельные загрузки на границе лимита сериализуются. Поток
      // файла в транзакцию не входит (долгий IO не держит соединение пула).
      row = await this.txRunner.run(async (tx) => {
        await this.repository.lockPendingLimit(ownerId, tx);
        this.assertPendingBelowLimit(await this.repository.countUnclaimed(ownerId, tx));
        return this.repository.insertAttachment(
          {
            id: randomUUID(),
            fileId,
            ownerId,
            name,
            size: input.size,
            mime: input.mime,
            kind,
            width: input.width ?? null,
            height: input.height ?? null,
            durationMs: input.durationMs ?? null,
          },
          tx,
        );
      });
    } catch (error) {
      // Строка не появилась — объект хранилища сирота: компенсируем сразу.
      await this.storage.remove([fileId]).catch((err: unknown) => {
        this.logger.warn({ err, fileId }, 'Не удалось убрать файл отклонённой загрузки');
      });
      throw error;
    }
    if (kind === 'video') {
      // Видео НЕ ставится в очередь на загрузке: до отправки вложение живёт
      // в трее композера, постер ему не нужен, а цикл «загрузил-отменил»
      // набивал бы очередь тысячами ffmpeg-задач (security #250). Плитка до
      // готовности живёт на клиентских метаданных; конвейер запускает
      // ленивый прогрев ленты (preview-warmup) — job создаётся, когда
      // сообщение уже в беседе.
    } else if (kind === 'image') {
      if (input.size <= SYNC_PREVIEW_BYTES) {
        // Синхронное превью (#221): миниатюра рождается В ответе загрузки —
        // пузырь отправителя (оптимистичный temp несёт этот DTO) и получатели
        // видят лёгкую миниатюру с первого кадра; оригинал в ленту не грузится
        // вовсе. Сбой ИЛИ гигант по пикселям (декомпрессионная бомба —
        // SYNC_PIXEL_LIMIT): фоновый запасной путь с просторным потолком.
        try {
          await this.thumbnails.generateFor(row.id, SYNC_PIXEL_LIMIT);
          row = (await this.repository.findAnyById(row.id)) ?? row;
        } catch (error) {
          this.logger.warn(
            { attachmentId: row.id, err: error },
            'Синхронное превью не удалось — уходим в фоновую очередь',
          );
        }
        if (!row.thumbFileId) {
          await this.thumbnailQueue.enqueue(row.id, fileId);
        }
      } else {
        // Тяжёлый файл: ресайз — работа BullMQ («HTTP тяжёлую работу не
        // выполняет»); готовность привезёт chat.attachment_preview_ready.
        await this.thumbnailQueue.enqueue(row.id, fileId);
      }
    }
    return this.toDto(row);
  }

  /** Отмена из трея композера: строка + объект. Best-effort — уже
   *  отправленное/чужое молча игнорируется (204). */
  async cancel(ownerId: string, attachmentId: string): Promise<void> {
    const row = await this.repository.findUnclaimed(attachmentId, ownerId);
    if (!row) return;
    await this.repository.deleteUnclaimed(attachmentId, ownerId);
    await this.storage.remove([row.fileId]);
  }

  private toDto(row: {
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
  }): MessageAttachment {
    return {
      id: row.id,
      fileId: row.fileId,
      name: row.name,
      size: row.size,
      mime: row.mime,
      kind: row.kind as 'image' | 'video' | 'file',
      url: this.signedUrls.fileContentUrl(row.fileId),
      // Превью — дериват в хранилище (#150); до готовности null (клиент
      // грузит оригинал, геометрия детерминирована отдельно).
      thumbnailUrl: row.thumbFileId ? this.signedUrls.fileContentUrl(row.thumbFileId) : null,
      // Маршрут просмотрщика и fallback-ссылка (#139) — как в mapper ленты.
      previewKind: attachmentPreviewKind(row.name, row.mime),
      pdfUrl: null,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
    };
  }

  /** Лимит неотправленных (≤20, вердикт владельца 24.09). */
  private assertPendingBelowLimit(pending: number): void {
    if (pending >= MAX_PENDING_ATTACHMENTS) {
      throw new DomainException(
        ErrorCode.CHAT_ATTACHMENT_TOO_MANY,
        'Too many unclaimed attachments',
        { max: MAX_PENDING_ATTACHMENTS },
      );
    }
  }

  /** Гигиена брошенных загрузок: не валит новую загрузку при сбое. */
  private async gcStaleUploads(ownerId: string): Promise<void> {
    try {
      const stale = await this.repository.findStaleUnclaimed(
        ownerId,
        new Date(Date.now() - STALE_UPLOAD_MS),
      );
      if (stale.length === 0) return;
      await this.repository.deleteUnclaimedByIds(
        ownerId,
        stale.map((row) => row.id),
      );
      await this.storage.remove(stale.map((row) => row.fileId));
      this.logger.info({ ownerId, count: stale.length }, 'Убраны брошенные загрузки вложений');
    } catch (error) {
      this.logger.warn({ err: error, ownerId }, 'GC брошенных загрузок не удался (не критично)');
    }
  }
}
