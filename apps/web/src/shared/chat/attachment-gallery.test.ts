import { describe, expect, it } from 'vitest';
import type { MessageAttachment } from '@nodus/contracts';

import { fitSingleBox, galleryRows, MEDIA_MAX_H, MEDIA_MAX_W } from './attachment-gallery.js';
import { uiPx } from '../ui/ui-scale.js';

const img = (n: number): MessageAttachment => ({
  id: `img-${n}`,
  fileId: `00000000-0000-4000-8000-00000000000${n}`,
  name: `фото-${n}.png`,
  size: 1000,
  mime: 'image/png',
  kind: 'image',
  url: `/demo/site-1.png`,
  thumbnailUrl: `/demo/site-1.png`,
  previewKind: 'image',
  pdfUrl: null,
  width: 1664,
  height: 928,
});

describe('galleryRows — раскладка галереи (plan chat-attachments-plan)', () => {
  it('пусто — без рядов', () => {
    expect(galleryRows([])).toEqual([]);
  });

  it('одно — крупная плитка одним рядом', () => {
    expect(galleryRows([img(1)])).toHaveLength(1);
    expect(galleryRows([img(1)])[0]).toHaveLength(1);
  });

  it('два и три — один ряд', () => {
    expect(galleryRows([img(1), img(2)])).toEqual([[img(1), img(2)]]);
    expect(galleryRows([img(1), img(2), img(3)])[0]).toHaveLength(3);
  });

  it('четыре и больше — ряды по три', () => {
    const rows = galleryRows([img(1), img(2), img(3), img(4)]);
    expect(rows.map((r) => r.length)).toEqual([3, 1]);
    const rows7 = galleryRows([1, 2, 3, 4, 5, 6, 7].map(img));
    expect(rows7.map((r) => r.length)).toEqual([3, 3, 1]);
  });
});

describe('fitSingleBox — детерминированный бокс плитки (#150)', () => {
  it('крупная альбомная — ширина до капа, высота по ratio', () => {
    const box = fitSingleBox(1664, 928);
    expect(box.width).toBe(Math.round(MEDIA_MAX_W));
    expect(box.height).toBe(Math.round(MEDIA_MAX_W / (1664 / 928)));
  });

  it('крупная портретная — высота до капа, ширина по ratio', () => {
    const box = fitSingleBox(928, 1664);
    expect(box.height).toBe(Math.round(MEDIA_MAX_H));
    expect(box.width).toBe(Math.round(MEDIA_MAX_H * (928 / 1664)));
  });

  it('мелкая картинка НЕ апскейлится — природный размер (модель Messenger)', () => {
    // 300×200 меньше всех капов: как есть, мыло от растяжения исключено.
    expect(fitSingleBox(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitSingleBox(200, 300)).toEqual({ width: 200, height: 300 });
    expect(fitSingleBox(100, 100)).toEqual({ width: 100, height: 100 });
  });

  it('микро-картинка поднимается до пола читаемости (Telegram minPhotoSize)', () => {
    expect(fitSingleBox(60, 60)).toEqual({ width: 100, height: 100 });
    // микро-портрет: пол по высоте, ширина по ratio
    expect(fitSingleBox(50, 90)).toEqual({ width: 56, height: 100 });
  });

  it('квадрат крупнее капа — бокс MAX_H×MAX_H', () => {
    expect(fitSingleBox(1000, 1000)).toEqual({
      width: Math.round(MEDIA_MAX_H),
      height: Math.round(MEDIA_MAX_H),
    });
  });

  it('габариты неизвестны/битые — фолбэк 4:3, бокс не зависит от загрузки', () => {
    const fallback = { width: Math.round(uiPx(320)), height: Math.round(uiPx(320) * 0.75) };
    expect(fitSingleBox(null, null)).toEqual(fallback);
    expect(fitSingleBox(0, 0)).toEqual(fallback);
    expect(fitSingleBox(-5, 100)).toEqual(fallback);
    expect(fitSingleBox(100, undefined)).toEqual(fallback);
  });

  it('целые px (дробные при --ui-scale округляются врозь — урок #96)', () => {
    const box = fitSingleBox(3841, 2160);
    expect(Number.isInteger(box.width)).toBe(true);
    expect(Number.isInteger(box.height)).toBe(true);
  });
});
