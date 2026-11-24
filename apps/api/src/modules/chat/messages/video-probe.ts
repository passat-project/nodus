/**
 * Разбор `ffprobe -print_format json` для видео-вложения (#250).
 *
 * Чистая функция: ffprobe-вывод — внешний JSON, доверять ему как данным нельзя
 * (битые/крафтовые файлы), поэтому поля проверяются и нормализуются. Ключевое:
 * **display matrix / тег rotate**: телефонные ролики часто хранятся
 * «альбомными» (1920×1080) с поворотом на 90° — без свопа сторон плитка
 * получает ложную геометрию и постер повёрнут.
 */
export interface VideoProbe {
  width: number;
  height: number;
  /** Длительность, мс; null — контейнер не сообщил (ролик всё равно играет). */
  durationMs: number | null;
}

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

/**
 * Первый настоящий видеопоток (обложки/attached_pic пропускаем) + длительность
 * контейнера. null — видео-потока нет или габариты негодны.
 */
export function parseVideoProbe(raw: unknown): VideoProbe | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { streams?: unknown; format?: { duration?: unknown } | null };
  if (!Array.isArray(data.streams)) return null;
  const stream = (data.streams as RawStream[]).find(
    (entry) =>
      entry.codec_type === 'video' && !(entry.disposition && entry.disposition.attached_pic === 1),
  );
  if (!stream) return null;
  const width = finitePositive(stream.width);
  const height = finitePositive(stream.height);
  if (!width || !height) return null;

  const rotated = rotationOf(stream) % 180 !== 0;
  const seconds = finitePositive(data.format?.duration) ?? finitePositive(stream.duration) ?? null;
  return {
    width: Math.round(rotated ? height : width),
    height: Math.round(rotated ? width : height),
    durationMs: seconds === null ? null : Math.round(seconds * 1000),
  };
}
