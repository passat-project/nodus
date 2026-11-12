// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AVATAR_CLIENT_PIXEL_GUARD,
  AVATAR_SKIP_COMPRESS_BYTES,
  AVATAR_TARGET_MAX_EDGE,
  avatarFileName,
  fitAvatarEdge,
  pickAvatarEncoding,
  prepareAvatarFile,
  shouldCompressAvatar,
} from './avatar-compress.js';

/**
 * Клиентское сжатие аватара (#725): фото 4 МБ / 24 Мп с телефона обязано
 * проходить (серверный потолок 4096² не ослабляется), маленькие файлы — без
 * лишней перекодировки, EXIF/метаданные не уезжают (перекодировка через canvas
 * их не переносит).
 */

const KB = 1024;
const MB = 1024 * KB;

describe('shouldCompressAvatar: пережимать только с пользой', () => {
  it('фото с телефона 4 МБ 6000×4000 (24 Мп) — пережимаем', () => {
    expect(shouldCompressAvatar({ size: 4 * MB, width: 6000, height: 4000 })).toBe(true);
  });

  it('маленькое фото 200 КБ — не трогаем (лишняя перекодировка портит качество)', () => {
    expect(shouldCompressAvatar({ size: 200 * KB, width: 3000, height: 3000 })).toBe(false);
  });

  it('большой файл, но габариты уже в норме — не пережимаем (запас до 10 МБ есть)', () => {
    expect(shouldCompressAvatar({ size: 3 * MB, width: 1600, height: 1200 })).toBe(false);
  });

  it('пиксельный потолок сервера превышен — пережимаем даже лёгкий файл', () => {
    // 5000×4000 = 20 Мп > 4096² (16,7 Мп): сервер откажет при любом размере.
    expect(shouldCompressAvatar({ size: 300 * KB, width: 5000, height: 4000 })).toBe(true);
  });

  it('границы: ровно 512 КБ и ровно 2048 px — без сжатия', () => {
    expect(
      shouldCompressAvatar({ size: AVATAR_SKIP_COMPRESS_BYTES, width: 4000, height: 2000 }),
    ).toBe(false);
    expect(
      shouldCompressAvatar({ size: 1 * MB, width: AVATAR_TARGET_MAX_EDGE, height: 1000 }),
    ).toBe(false);
  });

  it('нулевые габариты (метаданные не прочитались) — не пережимаем', () => {
    expect(shouldCompressAvatar({ size: 4 * MB, width: 0, height: 0 })).toBe(false);
  });

  it('зеркало серверного потолка — 4096²', () => {
    expect(AVATAR_CLIENT_PIXEL_GUARD).toBe(4096 * 4096);
  });
});

describe('fitAvatarEdge: длинная сторона ≤ 2048, пропорции сохранены', () => {
  it('6000×4000 → 2048×1365', () => {
    expect(fitAvatarEdge(6000, 4000)).toEqual({ width: 2048, height: 1365 });
  });

  it('портрет разворачивается по длинной стороне', () => {
    expect(fitAvatarEdge(1000, 3000)).toEqual({ width: 683, height: 2048 });
  });

  it('меньше потолка — как есть', () => {
    expect(fitAvatarEdge(1000, 800)).toEqual({ width: 1000, height: 800 });
  });
});

describe('avatarFileName: расширение под новый mime', () => {
  it('WebP и JPEG', () => {
    expect(avatarFileName('IMG_1234.JPG', 'image/webp')).toBe('IMG_1234.webp');
    expect(avatarFileName('photo.jpeg', 'image/jpeg')).toBe('photo.jpg');
  });

  it('без расширения — дефолтное имя', () => {
    expect(avatarFileName('photo', 'image/webp')).toBe('photo.webp');
  });

  it('пустое имя не ломает загрузку', () => {
    expect(avatarFileName('', 'image/jpeg')).toBe('avatar.jpg');
  });
});

describe('pickAvatarEncoding: выбор результата перекодировки', () => {
  it('кандидат меньше оригинала — берём самый лёгкий', () => {
    const big = new Blob([new Uint8Array(900)]);
    const small = new Blob([new Uint8Array(400)]);
    expect(pickAvatarEncoding(1000, [big, small])).toBe(small);
  });

  it('перекодировка не дала выигрыша — оставляем оригинал', () => {
    const bigger = new Blob([new Uint8Array(1200)]);
    expect(pickAvatarEncoding(1000, [bigger])).toBeNull();
  });

  it('пустые кандидаты игнорируются', () => {
    expect(pickAvatarEncoding(1000, [new Blob([])])).toBeNull();
    expect(pickAvatarEncoding(1000, [])).toBeNull();
  });
});

/** jsdom не рисует: decode-результат и кодирование подменяем (проверяем
 *  решение и сборку файла, не растеризатор браузера). */
function stubAvatarPipeline(options: {
  width: number;
  height: number;
  encode?: (type: string) => Blob | null;
}): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: options.width, height: options.height, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    callback(options.encode ? options.encode(type ?? 'image/png') : null);
  });
}

function photoFile(bytes: number, type = 'image/jpeg', name = 'IMG_1234.JPG'): File {
  // Заполнение нулями: содержимое не декодируется (createImageBitmap подменён).
  return new File([new Uint8Array(bytes)], name, { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prepareAvatarFile: фото с телефона сжимается перед загрузкой', () => {
  it('4 МБ 6000×4000 → WebP-копия меньше оригинала (без EXIF)', async () => {
    stubAvatarPipeline({
      width: 6000,
      height: 4000,
      encode: (type) => new Blob([new Uint8Array(300 * KB)], { type }),
    });

    const prepared = await prepareAvatarFile(photoFile(4 * MB));

    expect(prepared.type).toBe('image/webp');
    expect(prepared.name).toBe('IMG_1234.webp');
    expect(prepared.size).toBeLessThan(1 * MB);
  });

  it('ориентация с телефона применяется при декоде: imageOrientation from-image (#725)', async () => {
    stubAvatarPipeline({ width: 6000, height: 4000, encode: (type) => new Blob([], { type }) });
    const file = photoFile(4 * MB);

    await prepareAvatarFile(file);

    // Без флага createImageBitmap отдаёт «сырой» поворот EXIF — лицо на боку,
    // а после перекодировки EXIF уже не спасёт.
    expect(vi.mocked(createImageBitmap)).toHaveBeenCalledWith(file, {
      imageOrientation: 'from-image',
    });
  });

  it('WebP не поддержан (canvas отдал другой тип) — фолбэк JPEG', async () => {
    stubAvatarPipeline({
      width: 6000,
      height: 4000,
      // Браузер без WebP: на запрос webp отдаёт png — это не кандидат.
      encode: (type) =>
        new Blob([new Uint8Array(400 * KB)], { type: type === 'image/webp' ? 'image/png' : type }),
    });

    const prepared = await prepareAvatarFile(photoFile(4 * MB));

    expect(prepared.type).toBe('image/jpeg');
    expect(prepared.name).toBe('IMG_1234.jpg');
    expect(prepared.size).toBeLessThan(1 * MB);
  });

  it('маленькое фото не пережимается — уходит исходный файл', async () => {
    stubAvatarPipeline({ width: 1200, height: 1200, encode: () => new Blob([]) });
    const original = photoFile(200 * KB);

    expect(await prepareAvatarFile(original)).toBe(original);
  });

  it('перекодировка вышла больше оригинала — уходит исходный файл', async () => {
    stubAvatarPipeline({
      width: 6000,
      height: 4000,
      encode: (type) => new Blob([new Uint8Array(5 * MB)], { type }),
    });
    const original = photoFile(4 * MB);

    expect(await prepareAvatarFile(original)).toBe(original);
  });

  it('нет createImageBitmap (старый браузер) — исходный файл, решение за сервером', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const original = photoFile(4 * MB);

    expect(await prepareAvatarFile(original)).toBe(original);
  });

  it('битый файл (decode упал) — не роняем загрузку, уходит оригинал', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('The source image could not be decoded');
      }),
    );
    const original = photoFile(4 * MB);

    expect(await prepareAvatarFile(original)).toBe(original);
  });

  it('метаданные снимаются перекодировкой: на сервер уходит только пиксельный blob', async () => {
    const encoded = new Blob([new Uint8Array(250 * KB)], { type: 'image/webp' });
    stubAvatarPipeline({ width: 6000, height: 4000, encode: () => encoded });

    const prepared = await prepareAvatarFile(photoFile(4 * MB));

    // canvas-перекодировка не переносит EXIF (ориентация уже применена
    // декодером, GPS/модель камеры не существуют в новом blob).
    expect(prepared.type).toBe('image/webp');
    expect(prepared.size).toBe(250 * KB);
  });
});
