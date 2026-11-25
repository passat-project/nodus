/**
 * Разбор `ffprobe -print_format json` для видео-вложения (#250).
 *
 * Чистая функция: ffprobe-вывод — внешний JSON, доверять ему как данным нельзя
 * (битые/крафтовые файлы), поэтому поля проверяются и нормализуются. Ключевое:
 * **display matrix / тег rotate**: телефонные ролики часто хранятся
 * «альбомными» (1920×1080) с поворотом на 90° — без свопа сторон плитка
 * получает ложную геометрию и постер повёрнут.
 *
 * Контейнер может нести НЕСКОЛЬКО видеопотоков: ffmpeg без `-map` выберет
 * самый крупный (security #250 — обход потолка габаритов через «маленький
 * первый + гигантский второй»), поэтому возвращаем `streamIndex` выбранного
 * (его и декодируем) и пиковые габариты по ВСЕМ потокам (их и проверяем).
 */
export interface VideoProbe {
  width: number;
  height: number;
  /** Длительность, мс; null — контейнер не сообщил (ролик всё равно играет). */
  durationMs: number | null;
  /** Индекс выбранного видеопотока — для `-map 0:<index>` в ffmpeg. */
  streamIndex: number;
  /** Максимальная сторона среди всех настоящих видеопотоков. */
  maxEdge: number;
  /** Максимум width×height среди всех настоящих видеопотоков. */
  maxPixels: number;
}

/** Потолок длительности = потолок DTO (24 ч): int4-колонка не переполняется. */
export const MAX_VIDEO_DURATION_MS = 86_400_000;

interface RawStream {
  codec_type?: unknown;
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  disposition?: { attached_pic?: unknown } | null;
  tags?: { rotate?: unknown } | null;
  side_data_list?: Array<{ rotation?: unknown }> | null;
}

function finitePositive(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/** Угол поворота из side_data (displaymatrix) или тега; нормализуем к 0–359. */
function rotationOf(stream: RawStream): number {
  const side = stream.side_data_list?.find((entry) => entry.rotation !== undefined);
  const raw = side?.rotation ?? stream.tags?.rotate;
  const parsed = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return 0;
  return ((Math.round(parsed) % 360) + 360) % 360;
}

/** Видимые габариты потока с учётом поворота (телефонные ролики). */
function displaySize(stream: RawStream): { width: number; height: number } | null {
  const width = finitePositive(stream.width);
  const height = finitePositive(stream.height);
  if (!width || !height) return null;
  const rotated = rotationOf(stream) % 180 !== 0;
  return {
    width: Math.round(rotated ? height : width),
    height: Math.round(rotated ? width : height),
  };
}

function isRealVideo(stream: RawStream): boolean {
  return (
    stream.codec_type === 'video' && !(stream.disposition && stream.disposition.attached_pic === 1)
  );
}

/**
 * Первый настоящий видеопоток (обложки/attached_pic пропускаем) + пиковые
 * габариты по остальным + длительность контейнера. null — видео-потока нет
 * или габариты выбранного негодны.
 */
export function parseVideoProbe(raw: unknown): VideoProbe | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { streams?: unknown; format?: { duration?: unknown } | null };
  if (!Array.isArray(data.streams)) return null;
  const streams = data.streams as RawStream[];
  const candidates: Array<{ index: number; width: number; height: number }> = [];
  let maxEdge = 0;
  let maxPixels = 0;
  streams.forEach((stream, index) => {
    if (!isRealVideo(stream)) return;
    const size = displaySize(stream);
    if (!size) return;
    candidates.push({ index, ...size });
    maxEdge = Math.max(maxEdge, size.width, size.height);
    maxPixels = Math.max(maxPixels, size.width * size.height);
  });
  const selected = candidates[0];
  if (!selected) return null;

  const stream = streams[selected.index]!;
  const seconds = finitePositive(data.format?.duration) ?? finitePositive(stream.duration) ?? null;
  const durationMs =
    seconds === null ? null : Math.min(Math.round(seconds * 1000), MAX_VIDEO_DURATION_MS);
  return {
    width: selected.width,
    height: selected.height,
    durationMs,
    streamIndex: selected.index,
    maxEdge,
    maxPixels,
  };
}
