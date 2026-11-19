import { Readable } from 'node:stream';
import { vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';

import { AuditRepository } from '../../../core/audit/audit.repository.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FilesRepository, type FileObjectRow, type FileVersionRow } from '../files.repository.js';
import { MinioStorageDriver } from '../storage/minio-storage.driver.js';
import type { OfficeConfig } from './office.config.js';
import { OfficeCallbackService } from './office-callback.service.js';
import { OfficeTokenService } from './office-token.service.js';

/** Общий harness unit-тестов колбэка ONLYOFFICE (не тест-файл: vitest его
 *  не собирает; импортируется тестами рядом). */

export const FILE_ID = '00000000-0000-0000-0000-00000000000f';
export const SECRET = 'test-secret-32-chars-aaaaaaaaaaaa';

export const SAVE_URL = 'https://nodus.by/cache/files/data/xxx/output.xlsx?expires=999';
/** md5 от тестового тела [1,2] в base64url — как подписывает DS. */
export const SAVE_URL_MD5 =
  'https://nodus.by/cache/files/data/xxx/output.xlsx?md5=DLmI0EKn8o3V_itVs_Wseg&expires=999';

/** Ключ объекта попытки сохранения уникален (AUD-015): формат
 *  `files/<id>/v<N>-<uuid>` — два параллельных колбэка не пишут один объект. */
export const ATTEMPT_KEY = new RegExp(
  `^files/${FILE_ID}/v\\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
);

export function makeFile(version = 1): FileObjectRow {
  return {
    id: FILE_ID,
    ownerId: '00000000-0000-0000-0000-000000000001',
    bucket: 'nodus-files',
    key: version === 1 ? `files/${FILE_ID}` : `files/${FILE_ID}/v${version}`,
    version,
    name: 'Смета.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1024,
    scanStatus: 'pending',
    derivedFrom: null,
    createdAt: new Date(),
  };
}

export function makeVersionRow(
  version: number,
  sourceKey: string | null,
  sourceLastsave: string | null,
): FileVersionRow {
  return {
    id: `00000000-0000-0000-0000-0000000000${version}0`,
    fileObjectId: FILE_ID,
    version,
    key: `files/${FILE_ID}/v${version}`,
    size: 1024,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sourceKey,
    sourceLastsave: sourceLastsave ? BigInt(Date.parse(sourceLastsave)) : null,
    createdAt: new Date(),
  };
}

export interface Mocks {
  findById: ReturnType<typeof vi.fn>;
  findVersions: ReturnType<typeof vi.fn>;
  findVersion: ReturnType<typeof vi.fn>;
  lockForSave: ReturnType<typeof vi.fn>;
  saveVersion: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  append: ReturnType<typeof vi.fn>;
  enqueuePdf: ReturnType<typeof vi.fn>;
  warnLog: ReturnType<typeof vi.fn>;
  filterActiveUserIds: ReturnType<typeof vi.fn>;
  editorsOf: ReturnType<typeof vi.fn>;
}

export interface Harness {
  service: OfficeCallbackService;
  tokens: OfficeTokenService;
  mocks: Mocks;
  tx: Record<string, unknown>;
}

export function makeHarness(
  file: FileObjectRow | null,
  versions: FileVersionRow[] = [],
  configOverrides: Partial<OfficeConfig> = {},
): Harness {
  const mocks: Mocks = {
    findById: vi.fn(async () => file),
    findVersions: vi.fn(async () => versions),
    findVersion: vi.fn(async () => null),
    // Замок строки файла первым шагом транзакции (AUD-015): по умолчанию
    // отдаёт те же снимки, что и чтение до транзакции — «нет гонки».
    lockForSave: vi.fn(async () => (file ? { file, latest: versions[0] ?? null } : null)),
    saveVersion: vi.fn(async (_tx: unknown, input: unknown) => input),
    // put ПОТРЕБЛЯЕТ стрим (как реальный putObject): без чтения md5-final
    // не наступит и сверка подписи не отработает.
    put: vi.fn(async (_key: string, _size: number, _mime: string, content: Readable) => {
      let bytes = 0;
      for await (const chunk of content) bytes += (chunk as Buffer).length;
      return { etag: 'e', bytes };
    }),
    remove: vi.fn(async () => undefined),
    emit: vi.fn(async () => undefined),
    append: vi.fn(async () => undefined),
    enqueuePdf: vi.fn(async () => undefined),
    warnLog: vi.fn(),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids),
    editorsOf: vi.fn(async () => [] as string[]),
  };
  const repo = mocks as unknown as FilesRepository;
  const driver = mocks as unknown as MinioStorageDriver;
  const tx = { marker: 'tx' };
  const txRunner = {
    run: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(tx)),
  } as unknown as TransactionRunner;
  const eventBus = mocks as unknown as EventBus;
  const audit = mocks as unknown as AuditRepository;
  const config: OfficeConfig = {
    enabled: true,
    editEnabled: true,
    jwtSecret: SECRET,
    apiInternalUrl: 'http://api-internal:3001',
    internalUrl: 'http://ds-internal:80',
    maxViewBytes: 52_428_800,
    ...configOverrides,
  };
  const tokens = new OfficeTokenService(config);
  const service = new OfficeCallbackService(
    repo,
    driver,
    txRunner,
    eventBus,
    audit,
    tokens,
    { enqueuePdf: mocks.enqueuePdf } as never,
    config,
    mocks as never,
    mocks as never,
    {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: mocks.warnLog,
    } as unknown as PinoLogger,
  );
  return { service, tokens, mocks, tx };
}

export function mockFetchOk(contentLength: number | null): ReturnType<typeof vi.fn> {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.close();
    },
  });
  const headers = new Map<string, string>();
  if (contentLength !== null) headers.set('content-length', String(contentLength));
  return vi.fn(async () => ({
    ok: true,
    body,
    headers: headers as unknown as Headers,
    status: 200,
  }));
}
