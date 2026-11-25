import { useState } from 'react';
import type { ChatMessage, MessageAttachment } from '@nodus/contracts';

import { AttachmentCard } from './attachment-card.js';
import { AttachmentGallery, fitSingleBox, MEDIA_MAX_W } from './attachment-gallery.js';
import { ImageLightbox } from './image-lightbox.js';
import { uiPx } from '../ui/ui-scale.js';

export type AttachmentLayout =
  | { mode: 'single'; media: MessageAttachment }
  | { mode: 'gallery'; media: MessageAttachment[] }
  | { mode: 'list'; items: MessageAttachment[] };

/** Ширина карточного списка (#150, вердикт владельца: «пузырь узкий, как в
 *  Битриксе, когда прикреплено хоть какое-то вложение»): узкая карточка
 *  задаёт ширину ВСЕГО пузыря, текст пишется узким с переносами, кнопка
 *  скачивания — у правого края. */
export const CARD_LIST_W = uiPx(300);
/** Пол колонки текста: карточка/медиа могут быть уже (маленькая картинка,
 *  микро-файл) — текст не должен сжиматься в иглу (Telegram msgMinWidth). */
const TEXT_COL_MIN = uiPx(240);
/** Пол читаемости строки меты у чистого изображения (без подписи/шапки):
 *  «изменено 01:38 ✓✓» не должна обрезаться краем узкого медиа-пузыря. */
export const MEDIA_META_FLOOR = uiPx(160);

/**
 * Режим показа вложений (#150, канон Telegram/Битрикс): галерея — ТОЛЬКО
 * когда вложения исключительно медиа (изображения и видео, #250); любой
 * файл в наборе «разбивает» галерею — весь набор (медиа и файлы) рендерится
 * карточным списком друг под другом, картинка/видео в нём — карточка с
 * квадратной миниатюрой. Чистая функция — unit-тест.
 */
export function attachmentsLayout(list: MessageAttachment[]): AttachmentLayout {
  // Стикер (#143) рендерится собственной веткой сообщения (без пузыря) —
  // из блока вложений исключён полностью.
  const items = list.filter((a) => a.kind !== 'sticker');
  const media = items.filter((a) => a.kind === 'image' || a.kind === 'video');
  if (items.length > 0 && media.length === items.length) {
    return media.length === 1 ? { mode: 'single', media: media[0]! } : { mode: 'gallery', media };
  }
  return { mode: 'list', items };
}

/**
 * Ширина пузыря/карточки сообщения с вложениями (#187, медиа-стиль Telegram:
 * изображение = ЧАСТЬ пузыря, ширина изображения = ширина пузыря, боковых
 * полей у медиа нет — подпись/мета переносятся в блоках со своими полями).
 * Механика Telegram: у фото подпись переносится по ширине фото (captionw),
 * у документа — узкая карточка. Стилер ширины:
 * - single — бокс из габаритов (без апскейла мелкого, #150); пол — мета/текст;
 * - gallery — ширина сетки MEDIA_MAX_W;
 * - list (файлы/микс) — узкая карточка CARD_LIST_W с полом колонки текста.
 * `hasTextColumn` (подпись/имя/цитата/пересылка) поднимает пол одиночного
 * изображения до TEXT_COL_MIN — текст не сжимается в иглу; чистое изображение
 * без текста ограничено только полом меты (узкий пузырь Telegram). `bare`
 * (#187 п.6, медиа без пузыря вообще: время — чип ПОВЕРХ картинки, полы не
 * нужны) — ширина строго по боксу медиа. Без вложений — null: пузырь w-fit
 * от текста. Чистая функция — unit-тест.
 */
export function mediaBubbleWidth(
  list: MessageAttachment[],
  opts: { hasTextColumn?: boolean; bare?: boolean } = {},
): number | null {
  const visible = list.filter((a) => a.kind !== 'sticker'); // стикер — без пузыря (#143)
  if (visible.length === 0) return null;
  const layout = attachmentsLayout(visible);
  if (layout.mode === 'single') {
    const w = fitSingleBox(layout.media.width, layout.media.height).width;
    if (opts.bare) return w;
    return Math.max(w, opts.hasTextColumn ? TEXT_COL_MIN : MEDIA_META_FLOOR);
  }
  if (layout.mode === 'gallery') return MEDIA_MAX_W;
  return Math.max(CARD_LIST_W, TEXT_COL_MIN);
}

/**
 * Вложения сообщения (грамматика Битрикс24, plan chat-attachments-plan.md):
 * блок ВЫШЕ текста пузыря (иначе аватар и хвостик отлипают к строке
 * вложений). Режим — `attachmentsLayout` (галерея только для «одних
 * картинок», микс — карточный список, #150); ширина колонки пузыря —
 * `mediaBubbleWidth` (карточка/медиа задаёт ширину, не текст). Изображения
 * и файлы разделены явно по `kind` контракта (не по mime).
 */
export function MessageAttachments({
  message,
  mine = false,
}: {
  message: ChatMessage;
  /** Чья поверхность сообщения (пузырь/пост) — тон вторичного текста карточек. */
  mine?: boolean;
}) {
  return <AttachmentBlock attachments={message.attachments} mine={mine} />;
}

/** Вложения как блок: та же грамматика и просмотрщики, что у сообщения —
 *  без зависимости от ChatMessage (внутренний хелпер MessageAttachments). */
function AttachmentBlock({
  attachments,
  mine = false,
}: {
  attachments: MessageAttachment[];
  mine?: boolean;
}) {
  const [openImageId, setOpenImageId] = useState<string | null>(null);
  if (attachments.length === 0) return null;
  const layout = attachmentsLayout(attachments);
  const listImages = layout.mode === 'list' ? layout.items.filter((a) => a.kind === 'image') : [];
  const openIndex = openImageId ? listImages.findIndex((a) => a.id === openImageId) : -1;
  return (
    <>
      {layout.mode === 'list' ? (
        <span className="flex w-full min-w-0 flex-col gap-1">
          {layout.items.map((item) => (
            <AttachmentCard
              key={item.id}
              attachment={item}
              mine={mine}
              onOpenImage={item.kind === 'image' ? () => setOpenImageId(item.id) : undefined}
            />
          ))}
        </span>
      ) : layout.mode === 'single' ? (
        <AttachmentGallery media={[layout.media]} />
      ) : (
        <AttachmentGallery media={layout.media} />
      )}
      {openIndex >= 0 ? (
        <ImageLightbox
          images={listImages}
          index={openIndex}
          onIndex={(index) => setOpenImageId(listImages[index]!.id)}
          onClose={() => setOpenImageId(null)}
        />
      ) : null}
    </>
  );
}
