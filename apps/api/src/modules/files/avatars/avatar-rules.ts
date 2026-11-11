/**
 * Правила файлов аватарок (#186): серверная валидация по magic bytes —
 * заявленному клиентом mime не верим (паттерн sticker-file-rules #143).
 * Чистые функции — детерминированные тесты. Лимит зеркалит клиентскую
 * превалидацию (shared/chat/avatar-upload.ts).
 */

export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/** Потолок пикселей декодирования (security #231, канон #221 SYNC_PIXEL_LIMIT:
 *  сжатый до сотен КБ монотонный PNG разворачивается в ~1 ГБ RAM синхронно
 *  в HTTP-запросе; аватар — мелкий UI-дериват 640px, 4096² за глаза). */
export const AVATAR_PIXEL_LIMIT = 4096 * 4096;
/** Минимальная сторона исходника: меньше — аватар нечитаем после кропа. */
export const AVATAR_MIN_SIDE = 64;
/** Сторона серверного квадратного WebP-деривата (кроп cover + attention):
 *  покрывает список 28dp, топбар 36dp и большое фото профиля 176dp на ×2. */
export const AVATAR_DERIVATIVE_SIDE = 640;

export type SniffedAvatarType = 'png' | 'webp' | 'jpeg';

export type AvatarFileIssue = 'format' | 'size';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** Формат по начальным байтам: PNG (8), WebP (RIFF….WEBP), JPEG (FFD8FF).
 *  null — не аватарный формат (GIF/SVG/видео — отказ). */
export function sniffAvatarType(head: Uint8Array): SniffedAvatarType | null {
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return 'webp';
  }
  if (
    head.length >= PNG_MAGIC.length &&
    Buffer.compare(Buffer.from(head.subarray(0, PNG_MAGIC.length)), PNG_MAGIC) === 0
  ) {
    return 'png';
  }
  if (
    head.length >= JPEG_MAGIC.length &&
    Buffer.compare(Buffer.from(head.subarray(0, JPEG_MAGIC.length)), JPEG_MAGIC) === 0
  ) {
    return 'jpeg';
  }
  return null;
}

/** Проверка буфера: формат + лимит размера (единый, до квадратизации). */
export function validateAvatarBytes(bytes: Uint8Array): {
  type: SniffedAvatarType;
  mime: string;
  issue: AvatarFileIssue | null;
} {
  const type = sniffAvatarType(bytes);
  if (!type) return { type: 'png', mime: '', issue: 'format' };
  return {
    type,
    mime: type === 'jpeg' ? 'image/jpeg' : `image/${type}`,
    issue: bytes.length > AVATAR_MAX_BYTES ? 'size' : null,
  };
}

/** sharp падает на декодировании сверх `limitInputPixels` сообщением
 *  «Input image exceeds pixel limit» (нативная проверка libvips, src/common.cc)
 *  — по нему отличаем «слишком большое разрешение» от «битого файла» (#725):
 *  фото с телефона 6000×4000 — 24 Мп при лимите 16,7 Мп. */
export function isPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}
