import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { ErrorCode } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/ports/file-storage.port.js';
import {
  AVATAR_DERIVATIVE_SIDE,
  AVATAR_MAX_BYTES,
  AVATAR_MIN_SIDE,
  AVATAR_PIXEL_LIMIT,
  isPixelLimitError,
  validateAvatarBytes,
} from './avatar-rules.js';

/** EXIF-ориентации 5–8 — поворот на 90°: физические стороны меняются
 *  местами (как видит браузер после авторазворота). */
function orientedSize(
  width: number | undefined,
  height: number | undefined,
  orientation: number | undefined,
): { width: number; height: number } {
  const w = width ?? 0;
  const h = height ?? 0;
  return orientation !== undefined && orientation >= 5
    ? { width: h, height: w }
    : { width: w, height: h };
}

export interface AvatarProcessInput {
  ownerId: string;
  name: string;
  /** Заявленный размер (File.size): сверяется с фактически прожитым стримом. */
  size: number;
}

/**
 * Конвейер аватарок (#186): общий для бесед (chat) и профилей сотрудников
 * (directory). Оригинал валидируется по magic bytes (PNG/JPEG/WebP ≤10 МБ),
 * сервер квадратизирует sharp'ом (cover-кроп с attention-стратегией —
 * лицо/салиентная зона остаётся в кадре; EXIF-поворот учитывается) в WebP
 * ≤640px — единый дериват для списка 28dp, топбара 36dp и большого фото
 * профиля 176dp ×2. Возвращает fileId ДЕРИВАТА (его и вешают на сущность);
 * оригинал сохраняется рядом (derivedFrom-маркер) — задел перекадровки.
 *
 * Синхронно в HTTP-запросе (не BullMQ): аватар — bounded-файл (≤10 МБ,
 * ресайз до ~0,5 с — потолок-страховка; реальные фото ужмёт клиент #191),
 * редкое действие; тяжёлые конвейеры (превью
 * вложений, PDF) остаются в очередях.
 */
@Injectable()
export class AvatarService {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly signedUrls: SignedUrlService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AvatarService.name);
  }

  async process(input: AvatarProcessInput, content: Readable): Promise<{ fileId: string }> {
    const bytes = await this.readAll(content, input.size);
    const valid = validateAvatarBytes(bytes);
    if (valid.issue === 'format') {
      throw new DomainException(ErrorCode.FILE_AVATAR_INVALID, 'Avatar must be PNG, JPEG or WebP');
    }
    if (valid.issue === 'size') {
      throw new DomainException(
        ErrorCode.FILE_AVATAR_INVALID,
        'Avatar exceeds 10 MB limit',
        { maxBytes: AVATAR_MAX_BYTES },
        413,
      );
    }

    let meta: sharp.Metadata;
    let derivative: Buffer;
    try {
      meta = await sharp(bytes, { limitInputPixels: AVATAR_PIXEL_LIMIT }).metadata();
      // Квадратная сторона: минимум из ориентированных сторон и потолка —
      // cover-кроп этой величиной никогда не апскейлит (без enlargement)
      // и всегда даёт точный квадрат (sharp безEnlargement на cover не
      // кропит — сторону считаем сами).
      const size = orientedSize(meta.width, meta.height, meta.orientation);
      if (size.width < AVATAR_MIN_SIDE || size.height < AVATAR_MIN_SIDE) {
        throw new DomainException(ErrorCode.FILE_AVATAR_INVALID, 'Avatar image is too small', {
          minSide: AVATAR_MIN_SIDE,
        });
      }
      const side = Math.min(size.width, size.height, AVATAR_DERIVATIVE_SIDE);
      derivative = await sharp(bytes, { limitInputPixels: AVATAR_PIXEL_LIMIT })
        .rotate()
        .resize(side, side, {
          fit: 'cover',
          position: sharp.strategy.attention,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (error) {
      if (error instanceof DomainException) throw error;
      // Пиксельный потолок (#231) — отдельный код (#725): файл не битый и не
      // тяжёлый по байтам, у фото слишком большое разрешение. Интерфейс по
      // коду показывает причину, а не вводящее в заблуждение «битое фото».
      if (isPixelLimitError(error)) {
        this.logger.warn(
          { err: error, pixelLimit: AVATAR_PIXEL_LIMIT },
          'Аватар превысил пиксельный потолок декодирования',
        );
        throw new DomainException(
          ErrorCode.FILE_AVATAR_TOO_LARGE_RESOLUTION,
          'Avatar image resolution exceeds limit',
          { pixelLimit: AVATAR_PIXEL_LIMIT },
        );
      }
      // sharp бросает на недекодируемом буфере (failOn по умолчанию) —
      // magic bytes прошли, но картинка битая; отказ доменный, не 500.
      this.logger.warn({ err: error }, 'Аватар не декодируется sharp');
      throw new DomainException(ErrorCode.FILE_AVATAR_INVALID, 'Avatar image is corrupted');
    }

    // Оригинал — после успешного декодирования (#725, security-ревью): отказ
    // «битый/маленький/пиксельный потолок» больше не оставляет сироту в
    // хранилище. Метаданные срезаем до записи: клиент не пережимает файлы
    // ≤512 КБ по правилу владельца — они приходят с EXIF (GPS/автор), а
    // оригинал лежит в бакете «на память» (задел перекадровки).
    const originalBytes = await this.withoutMetadata(bytes, meta, valid.mime);
    const original = await this.storage.save(
      {
        ownerId: input.ownerId,
        name: input.name || 'avatar',
        mime: valid.mime,
        size: originalBytes.length,
      },
      Readable.from(originalBytes),
    );

    const baseName = input.name.replace(/\.[^.]+$/, '') || 'avatar';
    const saved = await this.storage.save(
      {
        ownerId: input.ownerId,
        name: `${baseName}.webp`,
        mime: 'image/webp',
        size: derivative.length,
        derivedFrom: original.fileId,
      },
      Readable.from(derivative),
    );
    return { fileId: saved.fileId };
  }

  /** Оригинал без метаданных (EXIF/GPS, XMP) — приватность «at rest»
   *  (#725, security-ревью 12.11): GPS сотрудника не должен лежать в бакете.
   *  Файл БЕЗ метаданных сохраняется байт-в-байт (без перекодировки и потери
   *  качества); с метаданными — перекодируется в свой формат, EXIF-ориентация
   *  запекается в пиксели (как её уже применяет дериват). */
  private async withoutMetadata(
    bytes: Buffer,
    meta: sharp.Metadata,
    mime: string,
  ): Promise<Buffer> {
    if (!meta.exif && !meta.xmp && !meta.orientation) return bytes;
    const pipeline = sharp(bytes, { limitInputPixels: AVATAR_PIXEL_LIMIT }).rotate();
    if (mime === 'image/png') return pipeline.png().toBuffer();
    if (mime === 'image/webp') return pipeline.webp({ quality: 95 }).toBuffer();
    return pipeline.jpeg({ quality: 95 }).toBuffer();
  }

  /** Подписанный URL отдачи аватара для DTO (сущность хранит fileId). */
  contentUrl(fileId: string): string {
    return this.signedUrls.fileContentUrl(fileId);
  }

  private async readAll(stream: Readable, declaredSize: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      total += (chunk as Buffer).length;
      if (total > AVATAR_MAX_BYTES + 1024) {
        stream.resume();
        throw new DomainException(
          ErrorCode.FILE_AVATAR_INVALID,
          'Avatar exceeds 10 MB limit',
          { maxBytes: AVATAR_MAX_BYTES, declaredSize },
          413,
        );
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }
}
