/**
 * Клиентская подготовка аватара (#725): фото с телефона (4 МБ, 6000×4000 =
 * 24 Мп) отклонялось серверным пиксельным потолком 4096² (#231) с молчаливым
 * отказом. Перед загрузкой фото декодируется `createImageBitmap` (EXIF-разворот
 * применяется браузером), при запасе по габаритам даунскейлится до 2048 px и
 * перекодируется в WebP q0.85 (фолбэк JPEG). Перекодировка через canvas
 * снимает ВСЕ метаданные, включая GPS.
 *
 * Серверные лимиты не ослабляются (#725): 10 МБ и 4096² — защита от
 * декомпрессионных бомб (#221/#231). Клиент лишь не посылает то, что сервер
 * всё равно отвергнет; маленькие файлы не пережимаются (лишняя перекодировка
 * только портит качество).
 */

/** Файлы ≤512 КБ не пережимаем: серверный лимит далеко, качество дороже. */
export const AVATAR_SKIP_COMPRESS_BYTES = 512 * 1024;
/** Потолок длинной стороны после даунскейла (серверный дериват — 640 px). */
export const AVATAR_TARGET_MAX_EDGE = 2048;
export const AVATAR_ENCODE_QUALITY = 0.85;
/** Зеркало серверного `AVATAR_PIXEL_LIMIT` (avatar-rules, 4096²): клиент не
 *  видит константу модуля api — как и `AVATAR_MAX_BYTES` в avatar-upload.ts.
 *  Превышение пережимаем ВСЕГДА, даже если файл лёгкий: иначе сервер откажет. */
export const AVATAR_CLIENT_PIXEL_GUARD = 4096 * 4096;

export interface AvatarImageInfo {
  /** Байты исходного файла. */
  size: number;
  width: number;
  height: number;
}

/** Пережимать ли фото перед загрузкой (чистая функция). */
export function shouldCompressAvatar({ size, width, height }: AvatarImageInfo): boolean {
  if (width <= 0 || height <= 0) return false;
  // Сервер не примет по пиксельному потолку — пережимаем независимо от байтов.
  if (width * height > AVATAR_CLIENT_PIXEL_GUARD) return true;
  // Маленькое фото — лишняя перекодировка только портит качество.
  if (size <= AVATAR_SKIP_COMPRESS_BYTES) return false;
  // Габариты в норме — запас до серверных 10 МБ есть, не трогаем.
  return Math.max(width, height) > AVATAR_TARGET_MAX_EDGE;
}

/** Целевой размер с сохранением пропорций: длинная сторона ≤ 2048. */
export function fitAvatarEdge(width: number, height: number): { width: number; height: number } {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= AVATAR_TARGET_MAX_EDGE) return { width, height };
  const scale = AVATAR_TARGET_MAX_EDGE / maxEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Выбор итогового кодирования (чистая функция): самый лёгкий кандидат,
 *  который реально меньше оригинала; иначе null — оставляем оригинал
 *  (перекодировка не дала выигрыша). */
export function pickAvatarEncoding(
  originalSize: number,
  candidates: ReadonlyArray<Blob>,
): Blob | null {
  let best: Blob | null = null;
  for (const candidate of candidates) {
    if (candidate.size === 0 || candidate.size >= originalSize) continue;
    if (!best || candidate.size < best.size) best = candidate;
  }
  return best;
}

/** Имя файла под новый mime (расширение меняется, база сохраняется). */
export function avatarFileName(name: string, mime: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'avatar';
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png';
  return `${base}.${ext}`;
}

type AvatarCanvas = HTMLCanvasElement | OffscreenCanvas;

function createAvatarCanvas(width: number, height: number): AvatarCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas: AvatarCanvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    const encoder = canvas as OffscreenCanvas;
    return encoder.convertToBlob({ type, quality }).catch(() => null);
  }
  const element = canvas as HTMLCanvasElement;
  return new Promise((resolve) => {
    try {
      element.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** 2D-контекст канваса любого вида (union-вызов getContext не типизируется). */
function drawContext(
  canvas: AvatarCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if ('convertToBlob' in canvas) return (canvas as OffscreenCanvas).getContext('2d');
  return (canvas as HTMLCanvasElement).getContext('2d');
}

async function decodeAvatar(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  // 'from-image' — применить EXIF-ориентацию к пикселям ДО рисования (иначе
  // портрет с телефона ляжет набок); сама перекодировка EXIF не переносит.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

async function encodeAvatar(bitmap: ImageBitmap, width: number, height: number): Promise<Blob[]> {
  const canvas = createAvatarCanvas(width, height);
  const context = canvas ? drawContext(canvas) : null;
  if (!canvas || !context) return [];
  context.drawImage(bitmap, 0, 0, width, height);

  const encoded: Blob[] = [];
  const webp = await canvasToBlob(canvas, 'image/webp', AVATAR_ENCODE_QUALITY);
  if (webp && webp.type === 'image/webp') {
    encoded.push(webp);
  } else {
    // Фолбэк: браузер не умеет WebP (toBlob молча отдаёт другой тип) — JPEG.
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', AVATAR_ENCODE_QUALITY);
    if (jpeg && jpeg.type === 'image/jpeg') encoded.push(jpeg);
  }
  return encoded;
}

/**
 * Подготовка аватара к загрузке: сжатая копия, если она нужна и выгодна,
 * иначе исходный файл. Никогда не бросает: не удалось сжать (нет
 * `createImageBitmap`/canvas, битый файл) — уходит оригинал, решение за
 * сервером (его лимиты и текст ошибки на месте).
 */
export async function prepareAvatarFile(file: File): Promise<File> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await decodeAvatar(file);
    if (!bitmap) return file;
    const { width, height } = bitmap;
    if (!shouldCompressAvatar({ size: file.size, width, height })) return file;
    const target = fitAvatarEdge(width, height);
    const best = pickAvatarEncoding(
      file.size,
      await encodeAvatar(bitmap, target.width, target.height),
    );
    if (!best) return file;
    return new File([best], avatarFileName(file.name, best.type), {
      type: best.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
