import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { PinoLogger } from 'nestjs-pino';
import { CHAT_EVENTS } from '@nodus/contracts';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import type { FileStorage } from '../../../core/ports/file-storage.port.js';
import { AttachmentsRepository, type AttachmentRow } from './attachments.repository.js';
import { ThumbnailService } from './thumbnail.service.js';
import { buildVideoPoster } from './video-thumbnail.js';

vi.mock('./video-thumbnail.js', () => ({ buildVideoPoster: vi.fn() }));
const buildPoster = vi.mocked(buildVideoPoster);

const OWNER = '00000000-0000-0000-0000-000000000001';
const FILE_ID = '00000000-0000-4000-8000-00000000000f';
const THUMB_ID = '00000000-0000-4000-8000-00000000000e';

const attachment = (overrides: Partial<AttachmentRow> = {}): AttachmentRow => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  fileId: FILE_ID,
  ownerId: OWNER,
  name: 'фото.png',
  size: 10_000,
  mime: 'image/png',
  kind: 'image',
  width: 1200,
  height: 600,
  durationMs: null,
  thumbFileId: null,
  ...overrides,
});

async function fixturePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } },
  })
    .png()
    .toBuffer();
}

interface SavedDerivative {
  mime: string;
  name: string;
  size: number;
  ownerId: string;
  derivedFrom?: string;
}

interface Harness {
  service: ThumbnailService;
  storage: FileStorage;
  saved: { input: SavedDerivative | null; buffer: Buffer };
  marked: {
    thumbFileId: string;
    width: number;
    height: number;
    durationMs?: number | null;
  }[];
  emitted: { type: string; payload: Record<string, unknown> }[];
  findConversationIdOf: (id: string) => Promise<string | null>;
}

function makeHarness(
  original: Buffer,
  attachmentRow: AttachmentRow | null,
  conversationId: string | null = null,
): Harness {
  const saved: Harness['saved'] = { input: null, buffer: Buffer.alloc(0) };
  const storage: FileStorage = {
    save: vi.fn(async (input, content) => {
      saved.input = input;
      const chunks: Buffer[] = [];
      for await (const chunk of content) chunks.push(chunk as Buffer);
      saved.buffer = Buffer.concat(chunks);
      return { fileId: THUMB_ID };
    }),
    get: vi.fn(async () => ({
      stream: Readable.from(original),
      mime: 'image/png',
      name: 'фото.png',
      size: original.byteLength,
    })),
    remove: vi.fn(async () => undefined),
  };
  const marked: Harness['marked'] = [];
  const emitted: Harness['emitted'] = [];
  const findConversationIdOf = vi.fn(async (): Promise<string | null> => conversationId);
  const repo = {
    findAnyById: vi.fn(async () => attachmentRow),
    findConversationIdOf,
    markThumbnail: vi.fn(
      async (
        _id: string,
        data: {
          thumbFileId: string;
          width: number;
          height: number;
          durationMs?: number | null;
        },
      ) => {
        marked.push(data);
        return true; // фиксация выиграла ( гонка #156 — отдельной веткой ниже )
      },
    ),
  } as unknown as AttachmentsRepository;
  const eventBus = {
    emit: vi.fn(async (_tx: unknown, type: string, payload: Record<string, unknown>) => {
      emitted.push({ type, payload });
    }),
  };
  const txRunner = {
    run: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({})),
  };
  const service = new ThumbnailService(
    storage,
    repo,
    new SignedUrlService({ STORAGE_URL_SECRET: 'test-secret-32-chars-aaaaaaaaaaaa' }),
    txRunner as never,
    eventBus as never,
    { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger,
  );
  return { service, storage, saved, marked, emitted, findConversationIdOf };
}

describe('ThumbnailService — серверные превью (#150)', () => {
  it('генерирует WebP ≤800 по большей стороне, пишет дериват и авторитетные размеры', async () => {
    const png = await fixturePng(1200, 600);
    const h = makeHarness(png, attachment());
    await h.service.generateFor('att-1');

    expect(h.saved.input).toMatchObject({
      mime: 'image/webp',
      size: h.saved.buffer.byteLength,
      derivedFrom: FILE_ID,
      ownerId: OWNER,
    });
    const meta = await sharp(h.saved.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(400);
    expect(h.marked).toEqual([{ thumbFileId: THUMB_ID, width: 1200, height: 600 }]);
  });

  it('мелкое изображение не увеличивается (withoutEnlargement)', async () => {
    const png = await fixturePng(300, 200);
    const h = makeHarness(png, attachment({ width: 300, height: 200 }));
    await h.service.generateFor('att-1');
    const meta = await sharp(h.saved.buffer).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
    expect(h.marked).toEqual([{ thumbFileId: THUMB_ID, width: 300, height: 200 }]);
  });

  it('EXIF-ориентация ≥5 меняет width/height местами (авторитетные габариты)', async () => {
    // Физически 800×400 + orientation 6 (поворот 90°) → видим 400×800.
    const jpeg = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 10, g: 120, b: 30 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const h = makeHarness(jpeg, attachment({ mime: 'image/jpeg' }));
    await h.service.generateFor('att-1');
    expect(h.marked).toEqual([{ thumbFileId: THUMB_ID, width: 400, height: 800 }]);
  });

  it('идемпотентно: готовое превью — no-op без чтения хранилища', async () => {
    const png = await fixturePng(50, 50);
    const h = makeHarness(png, attachment({ thumbFileId: THUMB_ID }));
    await h.service.generateFor('att-1');
    expect(h.storage.get).not.toHaveBeenCalled();
    expect(h.marked).toEqual([]);
  });

  it('не-изображение и отсутствующая строка — no-op', async () => {
    const png = await fixturePng(50, 50);
    const file = makeHarness(png, attachment({ kind: 'file' }));
    await file.service.generateFor('att-1');
    expect(file.storage.get).not.toHaveBeenCalled();

    const none = makeHarness(png, null);
    await none.service.generateFor('att-1');
    expect(none.storage.get).not.toHaveBeenCalled();
  });

  it('недекодируемый буфер — тихий отказ без записи', async () => {
    const h = makeHarness(Buffer.from('not an image at all'), attachment());
    await h.service.generateFor('att-1');
    expect(h.marked).toEqual([]);
  });

  it('готовность превью отправленного вложения — событие chat.attachment_preview_ready (#221)', async () => {
    const png = await fixturePng(1200, 600);
    const h = makeHarness(png, attachment());
    vi.mocked(h.findConversationIdOf).mockResolvedValue('00000000-0000-4000-8000-0000000000c1');
    await h.service.generateFor('att-1');
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]!.type).toBe(CHAT_EVENTS.ATTACHMENT_PREVIEW_READY);
    expect(h.emitted[0]!.payload).toMatchObject({
      conversationId: '00000000-0000-4000-8000-0000000000c1',
      attachmentId: 'att-1',
    });
    expect(h.emitted[0]!.payload.thumbnailUrl as string).toContain(THUMB_ID);
  });

  it('пиксельный потолок (security #221): 4097² под sync-лимитом 4096² — тихий отказ, превью нет', async () => {
    const png = await fixturePng(4097, 4097); // монотонный цвет — PNG лёгкий, декод был бы ~67 МБ
    const h = makeHarness(png, attachment());
    await h.service.generateFor('att-1', 4096 * 4096);
    expect(h.marked).toEqual([]);
    expect(h.emitted).toHaveLength(0);
  });

  it('неотправленное вложение — без события (DTO отправки возьмёт свежий thumbFileId)', async () => {
    const png = await fixturePng(1200, 600);
    const h = makeHarness(png, attachment()); // findConversationIdOf → null
    await h.service.generateFor('att-1');
    expect(h.marked).toHaveLength(1);
    expect(h.emitted).toHaveLength(0);
  });

  it('видео: постер ffmpeg, авторитетная длительность и событие готовности (#250)', async () => {
    buildPoster.mockResolvedValueOnce({
      width: 1080,
      height: 1920,
      durationMs: 12_345,
      poster: Buffer.from([1, 2, 3]),
    });
    const h = makeHarness(
      Buffer.alloc(0),
      attachment({
        id: 'att-1',
        kind: 'video',
        mime: 'video/mp4',
        width: 1920,
        height: 1080,
        durationMs: 1000,
      }),
    );
    vi.mocked(h.findConversationIdOf).mockResolvedValue('conv-1');
    await h.service.generateFor('att-1');

    expect(buildPoster).toHaveBeenCalledTimes(1);
    expect(h.saved.input).toMatchObject({
      mime: 'image/webp',
      size: 3,
      derivedFrom: FILE_ID,
    });
    expect(h.marked).toEqual([
      { thumbFileId: THUMB_ID, width: 1080, height: 1920, durationMs: 12_345 },
    ]);
    expect(h.emitted[0]?.payload).toMatchObject({
      conversationId: 'conv-1',
      attachmentId: 'att-1',
      width: 1080,
      height: 1920,
      durationMs: 12_345,
    });
  });

  it('видео без читаемого постера — тихий отказ, метаданные не пишутся', async () => {
    buildPoster.mockResolvedValueOnce(null);
    const h = makeHarness(Buffer.alloc(0), attachment({ kind: 'video', mime: 'video/mp4' }));
    await h.service.generateFor('att-1');
    expect(h.marked).toEqual([]);
    expect(h.emitted).toHaveLength(0);
  });
});
