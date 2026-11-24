import { Readable } from 'node:stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PinoLogger } from 'nestjs-pino';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import type { FileStorage } from '../../../core/ports/file-storage.port.js';
import { AttachmentsRepository, type AttachmentRow } from './attachments.repository.js';
import { AttachmentsService } from './attachments.service.js';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PENDING_ATTACHMENTS,
  SYNC_PREVIEW_BYTES,
} from './attachments.constants.js';
import type { ThumbnailService } from './thumbnail.service.js';

const OWNER = '00000000-0000-0000-0000-000000000001';
const TX = 'tx-handle';
const THUMB_FILE_ID = '00000000-0000-0000-0000-00000000000e';

function makeService(
  storageOverrides: Partial<FileStorage> = {},
  repoOverrides: Partial<AttachmentsRepository> = {},
  thumbnailsOverrides: Partial<ThumbnailService> = {},
): {
  service: AttachmentsService;
  storage: FileStorage;
  repo: AttachmentsRepository;
  thumbnailQueue: { enqueue: ReturnType<typeof vi.fn> };
  thumbnails: { generateFor: ReturnType<typeof vi.fn> };
} {
  const storage: FileStorage = {
    save: vi.fn(async () => ({ fileId: '00000000-0000-0000-0000-00000000000f' })),
    get: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
    ...storageOverrides,
  };
  const repo = {
    countUnclaimed: vi.fn(async () => 0),
    lockPendingLimit: vi.fn(async () => undefined),
    findStaleUnclaimed: vi.fn(async () => []),
    deleteUnclaimedByIds: vi.fn(async () => undefined),
    insertAttachment: vi.fn(async (row: AttachmentRow): Promise<AttachmentRow> => row),
    findAnyById: vi.fn(async (id: string): Promise<AttachmentRow | null> => ({
      id,
      fileId: '00000000-0000-0000-0000-00000000000f',
      ownerId: OWNER,
      name: 'foto.png',
      size: 10,
      mime: 'image/png',
      kind: 'image',
      width: 640,
      height: 480,
      durationMs: null,
      thumbFileId: THUMB_FILE_ID,
    })),
    findUnclaimed: vi.fn(async () => null),
    deleteUnclaimed: vi.fn(async () => true),
    ...repoOverrides,
  } as unknown as AttachmentsRepository;
  const thumbnailQueue = { enqueue: vi.fn(async () => undefined) } as unknown as {
    enqueue: ReturnType<typeof vi.fn>;
  };
  const thumbnails = {
    generateFor: vi.fn(async () => undefined),
    ...thumbnailsOverrides,
  } as unknown as { generateFor: ReturnType<typeof vi.fn> };
  const service = new AttachmentsService(
    storage,
    repo,
    new SignedUrlService({ STORAGE_URL_SECRET: 'test-secret-32-chars-aaaaaaaaaaaa' }),
    thumbnailQueue as never,
    thumbnails as unknown as ThumbnailService,
    { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger,
    { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) } as never,
  );
  return { service, storage, repo, thumbnailQueue, thumbnails };
}

function content(): Readable {
  return Readable.from(['hello']);
}

describe('AttachmentsService (#57, синхронное превью #221)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('изображение ≤ SYNC_PREVIEW_BYTES: миниатюра рождается В ответе загрузки, очередь не занимается', async () => {
    const { service, thumbnails, thumbnailQueue } = makeService();
    const dto = await service.upload(
      OWNER,
      { name: 'foto.png', mime: 'image/png', size: 10, width: 640, height: 480 },
      content(),
    );
    expect(dto.kind).toBe('image');
    expect(dto.width).toBe(640);
    expect(dto.url).toMatch(/^\/api\/v1\/files\/.+\/content\?exp=\d+&sig=[0-9a-f]{64}$/);
    // Свежая строка перечитана после генерации — превью уже в DTO.
    expect(dto.thumbnailUrl).toMatch(/^\/api\/v1\/files\/.+\/content\?exp=\d+&sig=/);
    expect(thumbnails.generateFor).toHaveBeenCalledTimes(1);
    expect(thumbnailQueue.enqueue).not.toHaveBeenCalled();
  });

  it('сбой синхронного превью не валит загрузку — запасной путь в очередь', async () => {
    const { service, thumbnails, thumbnailQueue } = makeService(
      {},
      {},
      { generateFor: vi.fn(async () => Promise.reject(new Error('sharp died'))) },
    );
    const dto = await service.upload(
      OWNER,
      { name: 'foto.png', mime: 'image/png', size: 10 },
      content(),
    );
    expect(dto.thumbnailUrl).toBeNull();
    expect(thumbnails.generateFor).toHaveBeenCalledTimes(1);
    expect(thumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('гигант по пикселям (sync-лимит security #221): запасной путь в очередь', async () => {
    // Перечитанная строка всё ещё без превью — sync-генерация тихо отказала
    // (декомпрессионная бомба превысила SYNC_PIXEL_LIMIT).
    const { service, thumbnails, thumbnailQueue } = makeService(
      {},
      {
        findAnyById: vi.fn(async (id: string): Promise<AttachmentRow | null> => ({
          id,
          fileId: '00000000-0000-0000-0000-00000000000f',
          ownerId: OWNER,
          name: 'bomb.png',
          size: 10,
          mime: 'image/png',
          kind: 'image',
          width: 16383,
          height: 16383,
          durationMs: null,
          thumbFileId: null,
        })),
      },
    );
    const dto = await service.upload(
      OWNER,
      { name: 'bomb.png', mime: 'image/png', size: 10 },
      content(),
    );
    expect(dto.thumbnailUrl).toBeNull();
    // Синхронный вызов — с жёстким пиксельным потолком.
    expect(thumbnails.generateFor).toHaveBeenCalledWith(expect.any(String), 4096 * 4096);
    expect(thumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it(`изображение > ${SYNC_PREVIEW_BYTES} байт — фоновая очередь, ответ без превью`, async () => {
    const { service, thumbnails, thumbnailQueue } = makeService();
    const dto = await service.upload(
      OWNER,
      { name: 'huge.png', mime: 'image/png', size: SYNC_PREVIEW_BYTES + 1 },
      content(),
    );
    expect(dto.thumbnailUrl).toBeNull();
    expect(thumbnails.generateFor).not.toHaveBeenCalled();
    expect(thumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('kind=file для не-изображений (превью не ставится в очередь)', async () => {
    const { service, thumbnailQueue, thumbnails } = makeService();
    const dto = await service.upload(
      OWNER,
      { name: 'doc.pdf', mime: 'application/pdf', size: 10 },
      content(),
    );
    expect(dto.kind).toBe('file');
    expect(thumbnailQueue.enqueue).not.toHaveBeenCalled();
    expect(thumbnails.generateFor).not.toHaveBeenCalled();
  });

  it('видео: kind=video, постер всегда в очереди, клиентские метаданные — резерв (#250)', async () => {
    const { service, thumbnails, thumbnailQueue } = makeService();
    const dto = await service.upload(
      OWNER,
      {
        name: 'clip.mp4',
        mime: 'video/mp4',
        size: 10,
        width: 1920,
        height: 1080,
        durationMs: 1000,
      },
      content(),
    );
    expect(dto.kind).toBe('video');
    // До ffprobe/постера DTO несёт клиентскую подсказку; авторитетные
    // значения привезёт chat.attachment_preview_ready (см. thumbnail.service).
    expect(dto.durationMs).toBe(1000);
    expect(dto.width).toBe(1920);
    expect(dto.height).toBe(1080);
    expect(dto.thumbnailUrl).toBeNull();
    // ffmpeg/ffprobe — тяжёлые внешние процессы: НИКОГДА в HTTP-пути.
    expect(thumbnails.generateFor).not.toHaveBeenCalled();
    expect(thumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('имя вложения санитизируется до хранения и DTO (security #250)', async () => {
    const { service, repo } = makeService();
    const dto = await service.upload(
      OWNER,
      {
        name: `${'очень длинное имя '.repeat(40)}.mp4`,
        mime: 'video/mp4',
        size: 10,
      },
      content(),
    );
    expect(dto.name.length).toBeLessThanOrEqual(200);
    expect(dto.name.endsWith('.mp4')).toBe(true);
    expect(vi.mocked(repo.insertAttachment).mock.calls[0]?.[0].name).toBe(dto.name);
  });

  it(`файл > ${MAX_ATTACHMENT_BYTES} байт — CHAT_ATTACHMENT_TOO_LARGE (413) до записи`, async () => {
    const { service, storage } = makeService();
    await expect(
      service.upload(
        OWNER,
        { name: 'big.zip', mime: 'application/zip', size: MAX_ATTACHMENT_BYTES + 1 },
        content(),
      ),
    ).rejects.toMatchObject({ code: 'CHAT_ATTACHMENT_TOO_LARGE', httpStatus: 413 });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it(`${MAX_PENDING_ATTACHMENTS}+ неотправленных — CHAT_ATTACHMENT_TOO_MANY`, async () => {
    const { service } = makeService(
      {},
      { countUnclaimed: vi.fn(async () => MAX_PENDING_ATTACHMENTS) },
    );
    await expect(
      service.upload(OWNER, { name: 'a.txt', mime: 'text/plain', size: 1 }, content()),
    ).rejects.toMatchObject({ code: 'CHAT_ATTACHMENT_TOO_MANY' });
  });

  it('лимит атомарен: лок владельца → перечёт → INSERT в одной tx (аудит #317)', async () => {
    // Arrange
    const { service, repo } = makeService();

    // Act
    await service.upload(OWNER, { name: 'a.txt', mime: 'text/plain', size: 1 }, content());

    // Assert: перечёт и вставка — по соединению tx, лок — до перечёта.
    expect(repo.lockPendingLimit).toHaveBeenCalledWith(OWNER, TX);
    expect(repo.countUnclaimed).toHaveBeenLastCalledWith(OWNER, TX);
    expect(repo.insertAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER }),
      TX,
    );
    const lockOrder = vi.mocked(repo.lockPendingLimit).mock.invocationCallOrder[0]!;
    const recountOrder = vi.mocked(repo.countUnclaimed).mock.invocationCallOrder[1]!;
    expect(lockOrder).toBeLessThan(recountOrder);
  });

  it('гонка на границе: перечёт под локом полон — отказ, объект хранилища убран', async () => {
    // Arrange: fast-fail ещё пропускает (19), конкурент успел — под локом 20.
    const fileId = '00000000-0000-0000-0000-00000000000f';
    const { service, repo, storage } = makeService(
      {},
      {
        countUnclaimed: vi
          .fn()
          .mockResolvedValueOnce(MAX_PENDING_ATTACHMENTS - 1)
          .mockResolvedValueOnce(MAX_PENDING_ATTACHMENTS),
      },
    );

    // Act + Assert
    await expect(
      service.upload(OWNER, { name: 'a.txt', mime: 'text/plain', size: 1 }, content()),
    ).rejects.toMatchObject({ code: 'CHAT_ATTACHMENT_TOO_MANY' });
    expect(repo.insertAttachment).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith([fileId]);
  });

  it('отмена: удаляет строку и объект хранилища; чужое/отправленное — молча', async () => {
    const fileId = '00000000-0000-0000-0000-00000000000f';
    const { service, storage } = makeService(
      {},
      {
        findUnclaimed: vi.fn(async () => ({
          id: 'att-1',
          fileId,
          ownerId: OWNER,
          name: 'a.txt',
          size: 1,
          mime: 'text/plain',
          kind: 'file',
          width: null,
          height: null,
          durationMs: null,
          thumbFileId: null,
        })),
      },
    );
    await service.cancel(OWNER, 'att-1');
    expect(storage.remove).toHaveBeenCalledWith([fileId]);
  });

  it('сбой GC брошенных загрузок не валит новую загрузку', async () => {
    const { service } = makeService(
      {},
      {
        findStaleUnclaimed: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    );
    const dto = await service.upload(
      OWNER,
      { name: 'a.txt', mime: 'text/plain', size: 1 },
      content(),
    );
    expect(dto.id).toBeTruthy();
  });
});
