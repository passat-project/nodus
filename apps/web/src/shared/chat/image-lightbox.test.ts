import { describe, expect, it } from 'vitest';

import { lightboxFrameStyle, resolveLightboxSources } from './lightbox-frame.js';

describe('resolveLightboxSources — полный кадр это ОРИГИНАЛ, не миниатюра (#221)', () => {
  it('url оригинала в приоритете, миниатюра — только промежуточный кадр', () => {
    expect(
      resolveLightboxSources({
        url: '/files/a/content?sig=1',
        thumbnailUrl: '/files/t/content?sig=2',
      }),
    ).toEqual({ fullSrc: '/files/a/content?sig=1', thumbSrc: '/files/t/content?sig=2' });
  });

  it('равные источники не дублируются — один <img> без кросс-фейда', () => {
    expect(resolveLightboxSources({ url: '/x.png', thumbnailUrl: '/x.png' })).toEqual({
      fullSrc: '/x.png',
      thumbSrc: null,
    });
  });

  it('без url (старые строки) — кадр из миниатюры, дубля нет', () => {
    expect(resolveLightboxSources({ url: null, thumbnailUrl: '/thumb.webp' })).toEqual({
      fullSrc: '/thumb.webp',
      thumbSrc: null,
    });
  });
});

describe('lightboxFrameStyle — кадр min(natural, 85vw, 85vh·ratio), без апскейла (#221)', () => {
  it('крупный ландшафт: вписывается в экран, natural не ограничивает', () => {
    const frame = lightboxFrameStyle(2400, 1600); // ratio 1.5
    expect(frame).not.toBeNull();
    expect(frame!.width).toBe('min(85vw, calc(85vh * 1.5), 2400px)');
    expect(frame!.aspectRatio).toBe('2400 / 1600');
  });

  it('портретный крупный: та же мин-цепочка с ratio < 1', () => {
    expect(lightboxFrameStyle(1080, 3840)!.width).toBe('min(85vw, calc(85vh * 0.28125), 1080px)');
    expect(lightboxFrameStyle(1080, 3840)!.aspectRatio).toBe('1080 / 3840');
  });

  it('мелкая картинка: бокс = natural (апскейла нет,Telegram/PhotoPrism-канон)', () => {
    const frame = lightboxFrameStyle(640, 426);
    // float-хвост ratio не проверяем дословно — структура + natural-потолок
    expect(frame!.width).toMatch(/^min\(85vw, calc\(85vh \* 1\.5023/);
    expect(frame!.width).toContain(', 640px)');
  });

  it('без габаритов — null (потоковый фолббек прошлой верстки)', () => {
    expect(lightboxFrameStyle(null, null)).toBeNull();
    expect(lightboxFrameStyle(0, 100)).toBeNull();
    expect(lightboxFrameStyle(100, -5)).toBeNull();
    expect(lightboxFrameStyle(undefined, undefined)).toBeNull();
  });
});
