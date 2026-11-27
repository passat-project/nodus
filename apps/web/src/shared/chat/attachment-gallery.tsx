import { useState } from 'react';
import type { MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useViewerHost } from '../files/viewer-host.js';
import { formatVideoDuration } from '../lib/format.js';
import { ImageLightbox } from './image-lightbox.js';
import { VideoPlayGlyph } from './video-play-glyph.js';
import { uiPx } from '../ui/ui-scale.js';

/**
 * Раскладка медиа-галереи (plan chat-attachments-plan.md; research:
 * rowboat/Slack — равновысотные плитки в ряд, CometChat — коллаж, Битрикс —
 * ряд превью): 1 медиа — одна крупная плитка; 2+ — ряды по 3. С #250 медиа —
 * это и изображения, и видео (одна грамматика). Чистая функция — unit-тест.
 */
export function galleryRows(media: MessageAttachment[]): MessageAttachment[][] {
  if (media.length === 0) return [];
  if (media.length === 1) return [media];
  const rows: MessageAttachment[][] = [];
  for (let i = 0; i < media.length; i += 3) rows.push(media.slice(i, i + 3));
  return rows;
}

/** Бокс медиа (#150): вписывается ratio из DTO; явные px дают вклад в
 *  fit-content-ширину пузыря — бокс стабилен ДО загрузки картинки (канон
 *  Telegram tdesktop/FB Messenger: «inline width from upload dims, иначе
 *  layout shift»). До капов дорастают и галерея, и одиночная плитка. */
export const MEDIA_MAX_W = uiPx(480);
export const MEDIA_MAX_H = uiPx(340);
const ROW_HEIGHT = uiPx(150);
/** Пол читаемости микро-картинок (Telegram minPhotoSize): сырые CSS-px БЕЗ
 *  uiPx — картинки ≥100px не должны подтягиваться масштабом интерфейса. */
const SINGLE_MIN_W = 100;
const FALLBACK_W = uiPx(320);

/**
 * Одиночная плитка из сохранённых габаритов. Модель FB Messenger (ishadeed,
 * разбор компонента: «if the image is smaller than the maximum values, we
 * display it as it is»): НЕ апскейлим — бокс не шире/выше природных px
 * картинки; капы MAX_W×MAX_H режут только крупное. Микро (<100px) поднимается
 * до пола читаемости. Без габаритов — фолбэк 4:3: бокс фиксируется и НЕ
 * меняется после загрузки. Целые px — дробные при --ui-scale округляются
 * врозь (урок Switch, #96). Чистая — unit-тест.
 */
export function fitSingleBox(
  width?: number | null,
  height?: number | null,
): { width: number; height: number } {
  if (!width || width <= 0 || !height || height <= 0) {
    return { width: Math.round(FALLBACK_W), height: Math.round(FALLBACK_W * 0.75) };
  }
  const ratio = width / height;
  let w = Math.min(MEDIA_MAX_W, width);
  let h = w / ratio;
  if (h > MEDIA_MAX_H) {
    h = MEDIA_MAX_H;
    w = h * ratio;
  }
  if (w < SINGLE_MIN_W || h < SINGLE_MIN_W) {
    if (ratio >= 1) {
      w = SINGLE_MIN_W;
      h = w / ratio;
    } else {
      h = SINGLE_MIN_W;
      w = h * ratio;
    }
  }
  return { width: Math.round(w), height: Math.round(h) };
}

const TILE_CLASS = 'relative min-w-0 overflow-hidden bg-muted';

function GalleryTile({
  image,
  single,
  onOpen,
}: {
  image: MessageAttachment;
  single: boolean;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  // Плитка живёт ТОЛЬКО на серверной миниатюре (#221): без неё — заглушка
  // (pulse) до chat.attachment_preview_ready; оригинал грузит один лишь
  // лайтбокс по клику — лента никогда не тянет мегабайты.
  const src = image.thumbnailUrl ?? '';
  const box = fitSingleBox(image.width, image.height);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={image.name}
      className={cn(
        // Одиночная плитка — full-bleed: БЕЗ собственного скругления (углы
        // пузыря/карточки режет контейнер) и БЕЗ фиксации высоты. Ширина —
        // 100% пузыря (ширина изображения = ширина пузыря, #187; проценты
        // безопасны: пузырь/карточка несут ЯВНЫЙ px из mediaBubbleWidth —
        // gotcha «fit-content + проценты» не применяется), высота — из
        // aspect-ratio по габаритам: пропорции держатся при сужении панели.
        TILE_CLASS,
        'cursor-zoom-in',
        single ? 'w-full shrink-0 rounded-none' : 'flex-1 rounded-none',
        !loaded && 'animate-pulse',
      )}
      style={single ? { aspectRatio: `${box.width} / ${box.height}` } : { height: ROW_HEIGHT }}
    >
      {src ? (
        <img
          src={src}
          alt={image.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cn(
            'size-full object-cover transition-opacity duration-150',
            !loaded && 'opacity-0',
          )}
        />
      ) : null}
    </button>
  );
}

/**
 * Видео-плитка (#250, модель Telegram; уточнение владельца 26.11.2026):
 * постер — серверный кадр (WebP), play ПО ЦЕНТРУ и бейдж длительности.
 * В ленте видео НЕ играет: и play, и клик по плитке открывают большой
 * кинозал (`AttachmentViewer` → `VideoPlayerView`) с крестиком и полосой
 * управления — как в Telegram, маленького плеера в сообщении нет. Кодек не
 * поддержан — табличка «Не удалось воспроизвести — Скачать» показывается
 * в кинозале, где и выясняется результат открытия.
 */
function VideoGalleryTile({
  video,
  single,
  onOpen,
}: {
  video: MessageAttachment;
  single: boolean;
  onOpen: () => void;
}) {
  const box = fitSingleBox(video.width, video.height);
  const duration = video.durationMs ?? null;
  return (
    <div
      className={cn(
        TILE_CLASS,
        'group/video',
        single ? 'w-full shrink-0 rounded-none' : 'flex-1 rounded-none',
      )}
      style={single ? { aspectRatio: `${box.width} / ${box.height}` } : { height: ROW_HEIGHT }}
    >
      <button
        type="button"
        onClick={() => onOpen()}
        aria-label={video.name}
        className="absolute inset-0 z-0 cursor-zoom-in"
      >
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : video.url ? (
          // Серверный постер не пришёл (хост без ffmpeg/старое видео) — кадр
          // из самого ролика: маленький `<video>` без звука и управления,
          // кадр на 0,1 с. Тяжёлый путь только для «без превью»; когда постер
          // есть, лента по-прежнему грузит одну картинку (#250).
          <video
            src={`${video.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none size-full object-cover"
          />
        ) : (
          <span className="block size-full bg-black/70" />
        )}
        {/* Наведение — чёрная вуаль-скрим, а не прозрачность кадра:
            opacity в светлой теме высветляла постер вместо затемнения. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-150 group-hover/video:bg-black/10"
        />
      </button>
      {/* Play — по ЦЕНТРУ кадра, как в Битриксе/Telegram (уточнение
          владельца 25.11.2026): крупная литая чашка, hairline-обводка
          держит край на тёмных постерах; `m-auto` при inset-0 — точное
          центрирование без дробных transform-сдвигов. */}
      <button
        type="button"
        onClick={() => onOpen()}
        aria-label={ui.chat.videoPlay}
        title={ui.chat.videoPlay}
        className="absolute inset-0 z-10 m-auto grid size-12 place-items-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
      >
        <VideoPlayGlyph className="size-6" />
      </button>
      {duration !== null ? (
        <span className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md border border-white/15 bg-black/55 px-1.5 py-0.5 font-mono text-label-xs text-white tabular-nums">
          {formatVideoDuration(duration)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Медиа-галерея сообщения (грамматика Битрикс24 + медиа-стиль #187):
 * плитки равной высоты в рядах по 3, одиночное — full-bleed превью на всю
 * ширину пузыря. Изображения открываются лайтбоксом (`image-lightbox.tsx`:
 * Esc/стрелки, счётчик, возврат фокуса на плитку), видео — кинозалом
 * (глобальный `AttachmentViewer` → «кинозал»): и play, и клик по плитке
 * ведут туда, в ленте видео не играет (#250, модель Telegram).
 * Геометрия — явные px из width/height: бокс обязателен до первого байта медиа.
 */
export function AttachmentGallery({ media }: { media: MessageAttachment[] }) {
  const viewer = useViewerHost();
  const [openImageId, setOpenImageId] = useState<string | null>(null);
  const images = media.filter((item) => item.kind === 'image');
  const rows = galleryRows(media);
  const openIndex = openImageId ? images.findIndex((image) => image.id === openImageId) : -1;
  return (
    <span
      className="flex min-w-0 max-w-full flex-col gap-0.5"
      style={rows.length > 1 || (rows[0]?.length ?? 0) > 1 ? { width: MEDIA_MAX_W } : undefined}
    >
      {rows.map((row, rowIndex) => {
        return (
          <span key={rowIndex} className="flex min-w-0 gap-0.5">
            {row.map((item) => {
              const single = rows.length === 1 && row.length === 1;
              return item.kind === 'video' ? (
                <VideoGalleryTile
                  key={item.id}
                  video={item}
                  single={single}
                  onOpen={() =>
                    viewer.open({
                      fileId: item.fileId,
                      name: item.name,
                      mime: item.mime,
                      size: item.size,
                      url: item.url,
                      previewKind: item.previewKind,
                      pdfUrl: item.pdfUrl,
                    })
                  }
                />
              ) : (
                <GalleryTile
                  key={item.id}
                  image={item}
                  single={single}
                  onOpen={() => setOpenImageId(item.id)}
                />
              );
            })}
          </span>
        );
      })}
      {openIndex >= 0 ? (
        <ImageLightbox
          images={images}
          index={openIndex}
          onIndex={(index) => setOpenImageId(images[index]?.id ?? null)}
          onClose={() => setOpenImageId(null)}
        />
      ) : null}
    </span>
  );
}
