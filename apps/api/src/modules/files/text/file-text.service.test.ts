import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { FileTextService } from './file-text.service.js';

/**
 * Текст вложения (#922): права → кэш по версии → извлечение. Тесты держат
 * порядок и предохранители: чужой файл не читается, кэш не пересчитывается,
 * потолок размера и ошибки парсера превращаются в коды контракта.
 */

const extract = vi.hoisted(() => vi.fn());
const detect = vi.hoisted(() => vi.fn(() => 'pdf' as const));
const errorClass = vi.hoisted(() => {
  class FileTextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return FileTextError;
});

vi.mock('./file-text.extractors.js', () => ({
  FILE_TEXT_LIMITS: {
    maxBytes: 20 * 1024 * 1024,
    maxPages: 100,
    maxChars: 60_000,
    requestsPerMinute: 10,
    maxConcurrent: 2,
  },
  FileTextError: errorClass,
  detectAttachmentKind: detect,
  extractAttachmentText: extract,
}));

const FILE = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: 'u-1',
  bucket: 'nodus-files',
  key: 'files/111',
  version: 2,
  name: 'Акт КС-2.pdf',
  mime: 'application/pdf',
  size: 1024,
  scanStatus: 'clean',
  derivedFrom: null,
  createdAt: new Date(),
};

const EXTRACTED = {
  kind: 'pdf' as const,
  pages: [{ page: 1, text: 'Акт выполнен' }],
  totalPages: 1,
  chars: 13,
  truncated: false,
  scannedPages: [],
};

function build(
  options: {
    cached?: unknown;
    file?: Partial<typeof FILE>;
    textDenied?: boolean;
  } = {},
) {
  const repo = {
    findTextExtract: vi.fn(async () =>
      options.cached === undefined
        ? null
        : { fileId: FILE.id, version: 2, kind: 'pdf', ...(options.cached as object) },
    ),
    saveTextExtract: vi.fn(async () => undefined),
  };
  const driver = {
    get: vi.fn(async () => Readable.from([Buffer.from('%PDF-1.7\n')])),
  };
  const office = {
    resolveAccess: vi.fn(async (fileId: string) => {
      void fileId;
      return {
        file: { ...FILE, ...options.file },
        canEdit: false,
        textDenied: options.textDenied ?? false,
      };
    }),
  };
  const logger = { setContext: vi.fn(), info: vi.fn() };
  const service = new FileTextService(
    repo as never,
    driver as never,
    office as never,
    logger as never,
  );
  return { service, repo, driver, office };
}

describe('FileTextService.extract (#922)', () => {
  it('кэш текущей версии отдаётся без чтения хранилища', async () => {
    const { service, driver } = build({
      cached: {
        pages: [{ page: 1, text: 'Из кэша' }],
        totalPages: 1,
        chars: 8,
        truncated: false,
        scannedPages: [],
      },
    });
    const result = await service.extract(FILE.id, 'u-1');
    expect(result.pages[0]!.text).toBe('Из кэша');
    expect(result.kind).toBe('pdf');
    expect(driver.get).not.toHaveBeenCalled();
  });

  it('новая версия пересчитывает текст и пишет кэш', async () => {
    extract.mockResolvedValueOnce(EXTRACTED);
    const { service, repo } = build();
    const result = await service.extract(FILE.id, 'u-1');
    expect(extract).toHaveBeenCalled();
    expect(repo.saveTextExtract).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE.id, version: 2, kind: 'pdf' }),
    );
    expect(result.pagesRead).toBe(1);
  });

  it('чужие права: резолвер не пустил — ошибка наружу, хранилище не тронуто', async () => {
    const repo = { findTextExtract: vi.fn(), saveTextExtract: vi.fn() };
    const driver = { get: vi.fn() };
    const office = {
      resolveAccess: vi.fn(async () => {
        throw new Error('NOT_FOUND');
      }),
    };
    const service = new FileTextService(
      repo as never,
      driver as never,
      office as never,
      { setContext: vi.fn(), info: vi.fn() } as never,
    );
    await expect(service.extract(FILE.id, 'stranger')).rejects.toThrow('NOT_FOUND');
    expect(driver.get).not.toHaveBeenCalled();
  });

  it('заражённый файл — 410, без извлечения', async () => {
    const { service, driver } = build({ file: { scanStatus: 'infected' } });
    await expect(service.extract(FILE.id, 'u-1')).rejects.toMatchObject({ httpStatus: 410 });
    expect(driver.get).not.toHaveBeenCalled();
  });

  it('файл больше потолка — 413 без чтения', async () => {
    const { service, driver } = build({ file: { size: 21 * 1024 * 1024 } });
    await expect(service.extract(FILE.id, 'u-1')).rejects.toMatchObject({ httpStatus: 413 });
    expect(driver.get).not.toHaveBeenCalled();
  });

  it('конфиденциальное письмо — 403 FILE_TEXT_FORBIDDEN до кэша и парсинга', async () => {
    const { service, repo, driver } = build({
      textDenied: true,
      cached: {
        pages: [{ page: 1, text: 'Секрет' }],
        totalPages: 1,
        chars: 6,
        truncated: false,
        scannedPages: [],
      },
    });
    await expect(service.extract(FILE.id, 'u-1')).rejects.toMatchObject({
      code: ErrorCode.FILE_TEXT_FORBIDDEN,
      httpStatus: 403,
    });
    expect(repo.findTextExtract).not.toHaveBeenCalled();
    expect(driver.get).not.toHaveBeenCalled();
  });

  it('лимит извлечений на сотрудника — 429 RATE_LIMITED', async () => {
    extract.mockResolvedValue(EXTRACTED);
    const { service } = build();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(service.extract(FILE.id, 'u-1')).resolves.toBeTruthy();
    }
    await expect(service.extract(FILE.id, 'u-1')).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
      httpStatus: 429,
    });
  });

  it('один сотрудник не занимает оба слота: второй параллельный разбор — 429', async () => {
    let release!: (value: typeof EXTRACTED) => void;
    // История вызовов старше этого теста: waitFor должен ждать ИМЕННО наш разбор.
    extract.mockClear();
    extract.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { service, office } = build();
    office.resolveAccess.mockImplementation(async (fileId: string) => ({
      file: { ...FILE, id: fileId, key: `files/${fileId}` },
      canEdit: false,
      textDenied: false,
    }));
    const first = service.extract('file-a', 'u-1');
    // Дождаться фактического старта разбора: до этого гейт ещё не занят.
    await vi.waitFor(() => expect(extract).toHaveBeenCalled());
    await expect(service.extract('file-b', 'u-1')).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
      httpStatus: 429,
    });
    release(EXTRACTED);
    await expect(first).resolves.toBeTruthy();
  });

  it('неподдерживаемый формат и таймаут парсера — коды контракта', async () => {
    detect.mockReturnValueOnce(null as never);
    const unsupported = build();
    await expect(unsupported.service.extract(FILE.id, 'u-1')).rejects.toMatchObject({
      code: ErrorCode.FILE_TEXT_UNSUPPORTED,
      httpStatus: 415,
    });

    extract.mockRejectedValueOnce(new errorClass('FILE_TEXT_TIMEOUT'));
    const timeout = build();
    await expect(timeout.service.extract(FILE.id, 'u-1')).rejects.toMatchObject({
      code: ErrorCode.FILE_TEXT_TIMEOUT,
      httpStatus: 504,
    });
  });
});
