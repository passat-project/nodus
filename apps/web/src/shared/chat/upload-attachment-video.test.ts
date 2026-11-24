// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api-client.js', () => ({
  apiUpload: vi.fn(async () => ({ id: 'att-video' })),
}));

import { apiUpload } from '../api-client.js';
import { uploadAttachment } from './upload-attachment.js';

/**
 * #250: метаданные видео до загрузки — `<video loadedmetadata>` даёт габариты
 * и длительность, форма несёт их подсказкой серверу (ffprobe перепроверит).
 * jsdom не умеет грузить медиа, поэтому элемент подменяется: тестируем нашу
 * обработку событий/полей, а не декодер браузера.
 */

interface FakeVideo {
  preload: string;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
  videoWidth: number;
  videoHeight: number;
  duration: number;
  src: string;
  removeAttribute: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
}

type Behavior = { width: number; height: number; duration: number } | 'error' | 'silent';

function fakeVideo(behavior: Behavior): FakeVideo {
  const el = {
    preload: '',
    onloadedmetadata: null,
    onerror: null,
    videoWidth: 0,
    videoHeight: 0,
    duration: 0,
    removeAttribute: vi.fn(),
    load: vi.fn(),
    set src(_value: string) {
      if (behavior === 'silent') return; // metadata не приходит — сработает таймаут
      queueMicrotask(() => {
        if (behavior === 'error') {
          el.onerror?.();
          return;
        }
        el.videoWidth = behavior.width;
        el.videoHeight = behavior.height;
        el.duration = behavior.duration;
        el.onloadedmetadata?.();
      });
    },
  } as unknown as FakeVideo;
  return el;
}

/** Подмена только тега video; остальные элементы создаются по-настоящему. */
function stubVideoElement(el: FakeVideo): void {
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'video' ? (el as unknown as HTMLElement) : realCreate(tag)) as never);
}

function formOf(call: unknown[]): FormData {
  return call[1] as FormData;
}

beforeEach(() => {
  vi.mocked(apiUpload).mockClear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:video'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('uploadAttachment — видео-метаданные (#250)', () => {
  it('габариты и длительность `<video>` уходят полями ДО файла', async () => {
    stubVideoElement(fakeVideo({ width: 1920, height: 1080, duration: 65.4 }));
    const file = new File(['x'], 'ролик.mp4', { type: 'video/mp4' });

    await uploadAttachment(file, () => undefined).promise;

    const form = formOf(vi.mocked(apiUpload).mock.calls[0]!);
    expect(form.get('width')).toBe('1920');
    expect(form.get('height')).toBe('1080');
    expect(form.get('durationMs')).toBe('65400');
    // previewUrl — objectURL страницы: у видео он играет роль src инлайн-плеера.
    expect(form.get('previewUrl')).toBe('blob:video');
    expect(form.get('file')).toBe(file);
  });

  it('битый ролик (onerror) — без метаданных, загрузка не падает', async () => {
    stubVideoElement(fakeVideo('error'));
    const file = new File(['x'], 'битый.mp4', { type: 'video/mp4' });

    await uploadAttachment(file, () => undefined).promise;

    const form = formOf(vi.mocked(apiUpload).mock.calls[0]!);
    expect(form.get('width')).toBeNull();
    expect(form.get('durationMs')).toBeNull();
    expect(form.get('size')).toBe('1');
  });

  it('нулевые габариты (битый контейнер) — метаданных нет', async () => {
    stubVideoElement(fakeVideo({ width: 0, height: 0, duration: 3 }));
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

    await uploadAttachment(file, () => undefined).promise;

    const form = formOf(vi.mocked(apiUpload).mock.calls[0]!);
    expect(form.get('width')).toBeNull();
    expect(form.get('durationMs')).toBeNull();
  });

  it('метаданные не пришли — таймаут 10 с, форма без полей', async () => {
    vi.useFakeTimers();
    stubVideoElement(fakeVideo('silent'));
    const file = new File(['x'], 'тишина.mp4', { type: 'video/mp4' });

    const pending = uploadAttachment(file, () => undefined).promise;
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    const form = formOf(vi.mocked(apiUpload).mock.calls.at(-1)!);
    expect(form.get('width')).toBeNull();
    expect(form.get('durationMs')).toBeNull();
  });
});
