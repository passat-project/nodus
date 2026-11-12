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

/** Метаданные, которые нельзя хранить «at rest» (#725, security-ревью 12.11):
 *  EXIF (GPS/автор), XMP, IPTC (город/страна), Photoshop-теги и PNG-текст —
 *  ImageMagick кладёт EXIF в tEXt-чанк «Raw profile type exif», тогда
 *  `meta.exif` пуст, а GPS лежит в комментариях. ICC-профиль не PII — не
 *  повод перекодировать файл (иначе срезались бы почти все фото с телефона). */
export function hasSensitiveMetadata(meta: {
  exif?: unknown;
  xmp?: unknown;
  orientation?: number;
  iptc?: unknown;
  tifftagPhotoshop?: unknown;
  comments?: unknown[];
  /** ICC — не PII: принимается, но сознательно не считается метаданными
   *  «на срез» (иначе перекодировались бы почти все фото с телефона). */
  icc?: unknown;
}): boolean {
  return Boolean(
    meta.exif ||
    meta.xmp ||
    meta.orientation ||
    meta.iptc ||
    meta.tifftagPhotoshop ||
    (meta.comments?.length ?? 0) > 0,
  );
}

export type AvatarFileIssue = 'format' | 'size';

/** PNG-чанки с произвольным текстом/метаданными: EXIF можно спрятать и после
 *  IDAT, а sharp такие (и JPEG COM/APPn) в `metadata()` не отдаёт — сырой
 *  скан контейнера закрывает этот носитель (#725, security-ревью 12.11). */
const SENSITIVE_PNG_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf']);
/** APP2 законен только как ICC-профиль (не PII); любой другой APP2 (MPF и
 *  прочие) — произвольная нагрузка, перекодируем. APP0/APP14 — только свои
 *  сигнатуры (JFIF/JFXX/Adobe): не-JFIF payload APP0 ревью 12.11 показало
 *  как рабочую «упаковку» произвольных данных. */
const ICC_SIGNATURE = Buffer.from('ICC_PROFILE\0', 'latin1');
const APP0_SIGNATURES = [Buffer.from('JFIF\0', 'latin1'), Buffer.from('JFXX\0', 'latin1')];
const APP14_SIGNATURE = Buffer.from('Adobe', 'latin1');

function pngHasSensitiveChunks(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (SENSITIVE_PNG_CHUNKS.has(type)) return true;
    if (length > bytes.length) return true; // порченый контейнер — fail-safe
    const next = offset + 12 + length;
    // Хвост после IEND (склеенные контейнеры, спрятанные данные) и IEND с
    // ненулевой длиной (payload ровно до EOF) — fail-safe.
    if (type === 'IEND') return length !== 0 || next !== bytes.length;
    offset = next;
  }
  return true;
}

function jpegHasSensitiveSegments(bytes: Buffer): boolean {
  let offset = 2; // после SOI
  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) return true; // не маркер — контейнер не понять
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // fill-байты перед маркером
      continue;
    }
    // Хвост после EOI — MPF/Motion Photo: второе изображение со своим EXIF
    // лежит после конца первичного (sharp видит только первичное).
    if (marker === 0xd9) return offset + 2 !== bytes.length;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // маркеры без длины
      continue;
    }
    if (offset + 4 > bytes.length) return true;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return true;
    // APP1 (EXIF/XMP), APP13 (IPTC/Photoshop), COM и прочие APPn — метаданные.
    // APP2 — только ICC, APP0/APP14 — только свои сигнатуры. Сегменты бывают
    // и МЕЖДУ сканами progressive JPEG, поэтому SOS не завершает обход.
    if (marker === 0xfe) return true;
    if (marker >= 0xe0 && marker <= 0xef) {
      const payload = bytes.subarray(offset + 4, offset + 2 + length);
      if (marker === 0xe2) {
        if (payload.subarray(0, ICC_SIGNATURE.length).compare(ICC_SIGNATURE) !== 0) return true;
      } else if (marker === 0xe0) {
        if (!APP0_SIGNATURES.some((sig) => payload.subarray(0, sig.length).compare(sig) === 0)) {
          return true;
        }
      } else if (marker === 0xee) {
        if (payload.subarray(0, APP14_SIGNATURE.length).compare(APP14_SIGNATURE) !== 0) return true;
      } else {
        return true;
      }
    }
    offset += 2 + length;
    if (marker === 0xda) {
      // Энтропийно-кодированные данные скана: до следующего настоящего
      // маркера (FF 00 — stuffing, FF D0–D7 — рестарт-маркеры).
      while (offset + 1 < bytes.length) {
        if (bytes[offset] === 0xff) {
          const next = bytes[offset + 1] ?? 0;
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break;
        }
        offset += 1;
      }
    }
  }
  return true; // дошли до конца без EOI — перекодируем на всякий случай
}

/** Сырой скан контейнера на носители PII, которые sharp.metadata() не отдаёт:
 *  JPEG COM/APPn и PNG-текст/EXIF после IDAT. true → перекодировать оригинал.
 *  WebP — false: EXIF/XMP отдаёт `metadata()`, текстовых чанков нет. */
export function hasSensitiveContainerMetadata(bytes: Buffer): boolean {
  const type = sniffAvatarType(bytes);
  if (type === 'png') return pngHasSensitiveChunks(bytes);
  if (type === 'jpeg') return jpegHasSensitiveSegments(bytes);
  return false;
}

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
