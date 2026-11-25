import { describe, expect, it } from 'vitest';
import type { MessageAttachment } from '@nodus/contracts';

import {
  attachmentsLayout,
  mediaBubbleWidth,
  CARD_LIST_W,
  MEDIA_META_FLOOR,
} from './attachments.js';
import { MEDIA_MAX_W } from './attachment-gallery.js';
import { uiPx } from '../ui/ui-scale.js';

const image = (n: number): MessageAttachment => ({
  id: `img-${n}`,
  fileId: `00000000-0000-4000-8000-00000000000${n}`,
  name: `фото-${n}.png`,
  size: 1000,
  mime: 'image/png',
  kind: 'image',
  url: '/demo/site-1.png',
  thumbnailUrl: '/demo/site-1.png',
  previewKind: 'image',
  pdfUrl: null,
  width: 1664,
  height: 928,
});

const file = (n: number): MessageAttachment => ({
  id: `file-${n}`,
  fileId: `10000000-0000-4000-8000-00000000000${n}`,
  name: `документ-${n}.pdf`,
  size: 2048,
  mime: 'application/pdf',
  kind: 'file',
  url: '/api/v1/files/x/content',
  thumbnailUrl: null,
  previewKind: 'pdf',
  pdfUrl: null,
  width: null,
  height: null,
});

const video = (n: number): MessageAttachment => ({
  id: `video-${n}`,
  fileId: `20000000-0000-4000-8000-00000000000${n}`,
  name: `ролик-${n}.mp4`,
  size: 5_000_000,
  mime: 'video/mp4',
  kind: 'video',
  url: '/api/v1/files/x/content',
  thumbnailUrl: '/api/v1/files/x/content',
  previewKind: 'video',
  pdfUrl: null,
  width: 1080,
  height: 1920,
  durationMs: 65_000,
});

describe('attachmentsLayout — режим показа вложений (#150, #250, канон Telegram)', () => {
  it('одно изображение — одиночная плитка', () => {
    expect(attachmentsLayout([image(1)])).toEqual({ mode: 'single', media: image(1) });
  });

  it('одно видео — одиночная медиа-плитка (#250: видео наравне с фото)', () => {
    expect(attachmentsLayout([video(1)])).toEqual({ mode: 'single', media: video(1) });
  });

  it('только медиа 2+ — галерея, порядок сохранён', () => {
    const layout = attachmentsLayout([image(1), image(2), image(3)]);
    expect(layout.mode).toBe('gallery');
    if (layout.mode !== 'gallery') return;
    expect(layout.media.map((a) => a.id)).toEqual(['img-1', 'img-2', 'img-3']);
  });

  it('фото+видео — та же галерея (смешанные медиа)', () => {
    const layout = attachmentsLayout([image(1), video(2)]);
    expect(layout.mode).toBe('gallery');
    if (layout.mode !== 'gallery') return;
    expect(layout.media.map((a) => a.id)).toEqual(['img-1', 'video-2']);
  });

  it('микс «фото+файл» — карточный список, галереи НЕТ, исходный порядок', () => {
    const layout = attachmentsLayout([image(1), file(2), image(3)]);
    expect(layout.mode).toBe('list');
    if (layout.mode !== 'list') return;
    expect(layout.items.map((a) => a.id)).toEqual(['img-1', 'file-2', 'img-3']);
  });

  it('видео+файл — карточный список (файл разбивает галерею)', () => {
    const layout = attachmentsLayout([video(1), file(2)]);
    expect(layout.mode).toBe('list');
    if (layout.mode !== 'list') return;
    expect(layout.items.map((a) => a.id)).toEqual(['video-1', 'file-2']);
  });

  it('только файлы — карточный список', () => {
    const layout = attachmentsLayout([file(1), file(2)]);
    expect(layout.mode).toBe('list');
    if (layout.mode !== 'list') return;
    expect(layout.items).toHaveLength(2);
  });

  it('пустой набор — список без элементов (вызывающий guards length>0)', () => {
    expect(attachmentsLayout([])).toEqual({ mode: 'list', items: [] });
  });
});

describe('mediaBubbleWidth — вложение задаёт ширину пузыря (#150 → медиа-стиль #187)', () => {
  it('без вложений — null (пузырь w-fit от текста, как раньше)', () => {
    expect(mediaBubbleWidth([])).toBeNull();
  });

  it('карточный список (файлы/микс) — узкая карточка с полом колонки текста', () => {
    expect(mediaBubbleWidth([file(1)])).toBe(Math.max(CARD_LIST_W, Math.round(uiPx(240))));
    expect(mediaBubbleWidth([image(1), file(2)])).toBe(
      Math.max(CARD_LIST_W, Math.round(uiPx(240))),
    );
  });

  it('галерея — ширина сетки медиа', () => {
    expect(mediaBubbleWidth([image(1), image(2)])).toBe(MEDIA_MAX_W);
    expect(mediaBubbleWidth([image(1), video(2)])).toBe(MEDIA_MAX_W);
  });

  it('одиночное видео — бокс по габаритам ролика (#250)', () => {
    // 1080×1920 (портрет): высота до капа, ширина по ratio.
    expect(mediaBubbleWidth([video(1)])).toBe(Math.round(uiPx(340) * (1080 / 1920)));
  });

  it('одиночная крупная картинка — её бокс: изображение = ширина пузыря (#187)', () => {
    expect(mediaBubbleWidth([image(1)])).toBe(Math.round(uiPx(480)));
  });

  it('мелкая картинка без текста — пол только меты (узкий медиа-пузырь Telegram)', () => {
    // 100×100 не апскейлится (#150); чистое изображение — пузырь по ширину
    // картинки, но не уже строки меты «изменено 01:38 ✓» (MEDIA_META_FLOOR).
    const small = { ...image(1), width: 100, height: 100 };
    expect(mediaBubbleWidth([small])).toBe(MEDIA_META_FLOOR);
  });

  it('мелкая картинка с подписью/шапкой — пол колонки текста (подпись не в иглу)', () => {
    const small = { ...image(1), width: 100, height: 100 };
    expect(mediaBubbleWidth([small], { hasTextColumn: true })).toBe(Math.round(uiPx(240)));
    expect(mediaBubbleWidth([small], { hasTextColumn: false })).toBe(MEDIA_META_FLOOR);
  });

  it('bare (#187 п.6): чистое изображение без пузыря — строго бокс медиа, без полов', () => {
    // время — чип ПОВЕРХ картинки, полы меты/текста не нужны
    const small = { ...image(1), width: 100, height: 100 };
    expect(mediaBubbleWidth([small], { bare: true })).toBe(100);
    expect(mediaBubbleWidth([image(1)], { bare: true })).toBe(Math.round(uiPx(480)));
  });
});
