import { describe, expect, it } from 'vitest';

import {
  AVATAR_MAX_BYTES,
  hasSensitiveContainerMetadata,
  hasSensitiveMetadata,
  sniffAvatarType,
  validateAvatarBytes,
} from './avatar-rules.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = Buffer.from('GIF89a');

describe('sniffAvatarType', () => {
  it('распознаёт PNG/JPEG/WebP по magic bytes', () => {
    expect(sniffAvatarType(PNG)).toBe('png');
    expect(sniffAvatarType(JPEG)).toBe('jpeg');
    expect(sniffAvatarType(WEBP)).toBe('webp');
  });

  it('GIF/SVG/мусор — не аватарный формат', () => {
    expect(sniffAvatarType(GIF)).toBeNull();
    expect(sniffAvatarType(Buffer.from('<svg/>'))).toBeNull();
    expect(sniffAvatarType(Buffer.alloc(4))).toBeNull();
  });
});

describe('validateAvatarBytes', () => {
  it('валидный PNG без issue, mime серверно-авторитетный', () => {
    const result = validateAvatarBytes(PNG);
    expect(result.issue).toBeNull();
    expect(result.mime).toBe('image/png');
  });

  it('превышение 2 МБ — issue size (клиентскому mime не верим)', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]);
    expect(validateAvatarBytes(big).issue).toBe('size');
  });

  it('не-изображение — issue format', () => {
    expect(validateAvatarBytes(GIF).issue).toBe('format');
  });
});

describe('hasSensitiveMetadata: что нельзя хранить в бакете (#725)', () => {
  it('EXIF/XMP/ориентация — срезать', () => {
    expect(hasSensitiveMetadata({ exif: Buffer.from('x') })).toBe(true);
    expect(hasSensitiveMetadata({ xmp: Buffer.from('x') })).toBe(true);
    expect(hasSensitiveMetadata({ orientation: 6 })).toBe(true);
  });

  it('IPTC и Photoshop-теги (город/страна без EXIF) — срезать', () => {
    expect(hasSensitiveMetadata({ iptc: Buffer.from('Minsk') })).toBe(true);
    expect(hasSensitiveMetadata({ tifftagPhotoshop: Buffer.from('x') })).toBe(true);
  });

  it('комментарии PNG-текста (ImageMagick raw profile) — срезать', () => {
    expect(hasSensitiveMetadata({ comments: ['Raw profile type exif'] })).toBe(true);
    expect(hasSensitiveMetadata({ comments: [] })).toBe(false);
  });

  it('ICC-профиль и пустые метаданные — НЕ повод перекодировать', () => {
    expect(hasSensitiveMetadata({ icc: Buffer.from('profile') })).toBe(false);
    expect(hasSensitiveMetadata({})).toBe(false);
  });
});

/** Минимальные контейнеры: сканер читает длины/типы, CRC не проверяет. */
function be32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function pngChunk(type: string, data: Buffer): Buffer {
  return Buffer.concat([be32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function fakePng(middle: Buffer[]): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', Buffer.alloc(13)),
    ...middle,
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}
function fakeJpeg(segments: Buffer[]): Buffer {
  // SOS + «данные кадра»: дальше сегментов метаданных нет.
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segments,
    jpegSegment(0xda, Buffer.alloc(4)),
    Buffer.alloc(8),
  ]);
}

describe('hasSensitiveContainerMetadata: носители, которых нет в sharp.metadata (#725)', () => {
  it('чистые контейнеры — перекодировка не нужна', () => {
    expect(hasSensitiveContainerMetadata(fakePng([]))).toBe(false);
    expect(hasSensitiveContainerMetadata(fakeJpeg([jpegSegment(0xe0, Buffer.from('JFIF'))]))).toBe(
      false,
    );
    expect(hasSensitiveContainerMetadata(fakeJpeg([jpegSegment(0xe2, Buffer.from('ICC'))]))).toBe(
      false,
    );
  });

  it('PNG-текст после IDAT — срезать (sharp его в metadata не отдаёт)', () => {
    expect(
      hasSensitiveContainerMetadata(
        fakePng([pngChunk('IDAT', Buffer.alloc(4)), pngChunk('tEXt', Buffer.from('GPS\0x'))]),
      ),
    ).toBe(true);
    expect(hasSensitiveContainerMetadata(fakePng([pngChunk('eXIf', Buffer.from('x'))]))).toBe(true);
  });

  it('JPEG COM и APPn (кроме ICC/Adobe) — срезать', () => {
    expect(hasSensitiveContainerMetadata(fakeJpeg([jpegSegment(0xfe, Buffer.from('GPS'))]))).toBe(
      true,
    );
    expect(hasSensitiveContainerMetadata(fakeJpeg([jpegSegment(0xe1, Buffer.from('Exif'))]))).toBe(
      true,
    );
    expect(hasSensitiveContainerMetadata(fakeJpeg([jpegSegment(0xed, Buffer.from('8BIM'))]))).toBe(
      true,
    );
  });

  it('порченый контейнер — fail-safe: перекодировать', () => {
    expect(hasSensitiveContainerMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff]))).toBe(true);
    expect(hasSensitiveContainerMetadata(Buffer.concat([PNG_SIGNATURE, be32(9999)]))).toBe(true);
  });
});
