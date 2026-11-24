import { describe, expect, it } from 'vitest';

import { parseVideoProbe } from './video-probe.js';

/** #250: ffprobe-вывод — внешние данные; поворот телефона меняет стороны. */
describe('parseVideoProbe — метаданные видео из ffprobe JSON', () => {
  it('обычный ролик: габариты и длительность контейнера', () => {
    const probe = parseVideoProbe({
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      format: { duration: '12.345' },
    });
    expect(probe).toEqual({ width: 1920, height: 1080, durationMs: 12345 });
  });

  it('поворот 90° (displaymatrix -90) — стороны меняются', () => {
    const probe = parseVideoProbe({
      streams: [
        {
          codec_type: 'video',
          width: 1920,
          height: 1080,
          side_data_list: [{ rotation: -90 }],
        },
      ],
      format: { duration: '5' },
    });
    expect(probe).toEqual({ width: 1080, height: 1920, durationMs: 5000 });
  });

  it('поворот 180° (тег rotate) — стороны не меняются', () => {
    const probe = parseVideoProbe({
      streams: [{ codec_type: 'video', width: 640, height: 480, tags: { rotate: '180' } }],
      format: { duration: '2' },
    });
    expect(probe).toEqual({ width: 640, height: 480, durationMs: 2000 });
  });

  it('обложка (attached_pic) не считается видеопотоком', () => {
    const probe = parseVideoProbe({
      streams: [
        { codec_type: 'video', width: 300, height: 300, disposition: { attached_pic: 1 } },
        { codec_type: 'video', width: 1280, height: 720 },
      ],
      format: { duration: '7.5' },
    });
    expect(probe).toEqual({ width: 1280, height: 720, durationMs: 7500 });
  });

  it('длительность из потока, если формат не сообщил', () => {
    const probe = parseVideoProbe({
      streams: [{ codec_type: 'video', width: 800, height: 600, duration: '3.2' }],
      format: {},
    });
    expect(probe?.durationMs).toBe(3200);
  });

  it('битые/пустые данные — null', () => {
    expect(parseVideoProbe(null)).toBeNull();
    expect(parseVideoProbe({})).toBeNull();
    expect(parseVideoProbe({ streams: [] })).toBeNull();
    expect(parseVideoProbe({ streams: [{ codec_type: 'audio', width: 1, height: 1 }] })).toBeNull();
    expect(
      parseVideoProbe({ streams: [{ codec_type: 'video', width: 0, height: 480 }] }),
    ).toBeNull();
  });

  it('нет длительности — null, но габариты есть', () => {
    const probe = parseVideoProbe({
      streams: [{ codec_type: 'video', width: 640, height: 360 }],
      format: {},
    });
    expect(probe).toEqual({ width: 640, height: 360, durationMs: null });
  });
});
