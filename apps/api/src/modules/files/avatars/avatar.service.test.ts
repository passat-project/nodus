import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import type { FileStorage } from '../../../core/ports/file-storage.port.js';
import { AVATAR_MAX_BYTES, AVATAR_PIXEL_LIMIT } from './avatar-rules.js';
import { AvatarService } from './avatar.service.js';

/** Пиксельная PNG 128×128 (через sharp — валидный декодируемый файл). */
async function testPng(width = 128, height = 128): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#3366aa' },
  })
    .png()
    .toBuffer();
}

function makeService() {
  const saved: Array<{
    input: { name: string; mime: string; size: number; derivedFrom?: string };
    bytes: Buffer;
  }> = [];
  const storage: FileStorage = {
    save: vi.fn(async (input, content) => {
      const bytes: Buffer[] = [];
      for await (const chunk of content) bytes.push(chunk as Buffer);
      const buf = Buffer.concat(bytes);
      saved.push({ input, bytes: buf });
      return { fileId: `file-${saved.length}` };
    }),
    get: vi.fn(),
    remove: vi.fn(),
  } as never;
  const signedUrls = { fileContentUrl: (id: string) => `/files/${id}/content` };
  const logger = { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const service = new AvatarService(storage, signedUrls as never, logger as never);
  return { service, saved };
}

describe('AvatarService.process', () => {
  beforeEach(() => vi.clearAllMocks());

  it('валидная PNG → квадратный WebP-дериват с derivedFrom оригинала', async () => {
    const { service, saved } = makeService();
    const png = await testPng(200, 100);

    const { fileId } = await service.process(
      { ownerId: 'u-1', name: 'фото.png', size: png.length },
      Readable.from(png),
    );

    // Оригинал + дериват; на сущность вешается дериват (второй save).
    expect(saved).toHaveLength(2);
    expect(saved[0]!.input.mime).toBe('image/png');
    expect(saved[0]!.input.derivedFrom).toBeUndefined();
    expect(saved[1]!.input.mime).toBe('image/webp');
    expect(saved[1]!.input.derivedFrom).toBe('file-1');
    expect(saved[1]!.input.name).toBe('фото.webp');
    expect(fileId).toBe('file-2');
    // Квадрат без апскейла: cover-кроп 200×100 → 100×100 (по меньшей стороне).
    const meta = await sharp(saved[1]!.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  it('недекодируемые байты с валидным PNG-заголовком → FILE_AVATAR_INVALID', async () => {
    const { service } = makeService();
    const broken = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 7),
    ]);
    await expect(
      service.process(
        { ownerId: 'u-1', name: 'x.png', size: broken.length },
        Readable.from(broken),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_AVATAR_INVALID });
  });

  it('GIF → FILE_AVATAR_INVALID (формат не аватарный)', async () => {
    const { service } = makeService();
    const gif = Buffer.from('GIF89a______');
    await expect(
      service.process({ ownerId: 'u-1', name: 'x.gif', size: gif.length }, Readable.from(gif)),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_AVATAR_INVALID });
  });

  it('стрим больше 10 МБ → 413 FILE_AVATAR_INVALID', async () => {
    const { service } = makeService();
    const png = await testPng();
    const big = Buffer.concat([png, Buffer.alloc(AVATAR_MAX_BYTES)]);
    const error = await service
      .process({ ownerId: 'u-1', name: 'big.png', size: big.length }, Readable.from(big))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe(ErrorCode.FILE_AVATAR_INVALID);
    expect((error as DomainException).httpStatus).toBe(413);
  });

  it('сторона меньше 64 → отказ (после кропа нечитаем)', async () => {
    const { service } = makeService();
    const tiny = await testPng(32, 32);
    await expect(
      service.process({ ownerId: 'u-1', name: 'tiny.png', size: tiny.length }, Readable.from(tiny)),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_AVATAR_INVALID });
  });

  it('пиксельный потолок (security #231): 4097² под лимитом 4096² → FILE_AVATAR_TOO_LARGE_RESOLUTION, деривата нет', async () => {
    const { service, saved } = makeService();
    // Монотонный цвет — PNG лёгкий, но декод был бы ~67 МБ; бомба 16383² — ~1 ГБ.
    const png = await testPng(4097, 4097);
    const error = await service
      .process({ ownerId: 'u-1', name: 'giant.png', size: png.length }, Readable.from(png))
      .catch((e: unknown) => e);
    // Отдельный код (#725): файл не битый — у фото слишком большое разрешение
    // (интерфейс показывает причину, а не «битое фото»).
    expect((error as DomainException).code).toBe(ErrorCode.FILE_AVATAR_TOO_LARGE_RESOLUTION);
    expect((error as DomainException).details).toMatchObject({ pixelLimit: AVATAR_PIXEL_LIMIT });
    // Оригинал теперь сохраняется ПОСЛЕ декода (#725, security-ревью): отказ
    // не оставляет сироту в хранилище и на сущность аватар не вешается.
    expect(saved).toHaveLength(0);
  });

  it('оригинал с EXIF (GPS/автор) сохраняется БЕЗ метаданных, ориентация запечена (#725)', async () => {
    const { service, saved } = makeService();
    // Клиент не пережимает файлы ≤512 КБ — EXIF доезжает до сервера; GPS
    // сотрудника не должен остаться в бакете.
    const jpeg = await sharp({
      create: { width: 128, height: 64, channels: 3, background: '#224466' },
    })
      .withExif({ IFD0: { Copyright: 'GPS 55.75N 37.61E' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    await service.process(
      { ownerId: 'u-1', name: 'фото.jpg', size: jpeg.length },
      Readable.from(jpeg),
    );

    expect(saved[0]!.input.mime).toBe('image/jpeg');
    const meta = await sharp(saved[0]!.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // EXIF-ориентация 6 запечена в пиксели: 128×64 → 64×128.
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(128);
  });

  it('файл без метаданных сохраняется байт-в-байт (без перекодировки)', async () => {
    const { service, saved } = makeService();
    const png = await testPng(128, 128);

    await service.process(
      { ownerId: 'u-1', name: 'фото.png', size: png.length },
      Readable.from(png),
    );

    expect(saved[0]!.bytes.equals(png)).toBe(true);
  });

  it('contentUrl — подписная ссылка отдачи', () => {
    const { service } = makeService();
    expect(service.contentUrl('abc')).toBe('/files/abc/content');
  });
});
