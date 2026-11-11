import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

import { MinioStorageDriver } from './minio-storage.driver.js';

/**
 * Уборка брошенных multipart-загрузок (#715): драйвер перечисляет
 * незавершённые загрузки бакета (ключ, uploadId, дата инициации, байты) и
 * отменяет конкретную загрузку по uploadId. Тесты — на стабе клиента:
 * контракт уборки, а не сеть (живой S3 — в интеграционном наборе).
 */

function driverWith(client: unknown): MinioStorageDriver {
  const driver = new MinioStorageDriver({
    endpoint: 'storage.invalid',
    port: 9000,
    useSSL: false,
    bucket: 'files',
    accessKey: 'test',
    secretKey: 'test-secret',
    staleUploadAgeHours: 24,
    staleUploadIntervalHours: 24,
  });
  // Клиент создаётся в конструкторе из конфига (Minio.Client) — в тесте
  // подменяем его стабом: проверяем контракт уборки, а не сеть.
  (driver as unknown as { client: unknown }).client = client;
  return driver;
}

describe('MinioStorageDriver: сбой загрузки', () => {
  it('отменяет незавершённую multipart-загрузку и убирает объект', async () => {
    const calls: string[] = [];
    const driver = driverWith({
      putObject: () => {
        calls.push('putObject');
        return Promise.reject(new Error('Access Denied'));
      },
      removeIncompleteUpload: (bucket: string, key: string) => {
        calls.push(`abort:${bucket}:${key}`);
        return Promise.resolve(true);
      },
      removeObjects: (bucket: string, keys: string[]) => {
        calls.push(`remove:${bucket}:${keys.join(',')}`);
        return Promise.resolve();
      },
    });

    await expect(
      driver.put('files/abc', 1024, 'application/pdf', Readable.from([Buffer.alloc(1024)])),
    ).rejects.toMatchObject({ code: 'FILE_SIZE_MISMATCH' });

    expect(calls).toEqual(['putObject', 'abort:files:files/abc', 'remove:files:files/abc']);
  });

  it('сбой уборки не подменяет исходную ошибку загрузки', async () => {
    const driver = driverWith({
      putObject: () => Promise.reject(new Error('boom')),
      removeIncompleteUpload: () => Promise.reject(new Error('abort failed')),
      removeObjects: () => Promise.resolve(),
    });

    await expect(
      driver.put('files/abc', 1024, 'application/pdf', Readable.from([Buffer.alloc(1024)])),
    ).rejects.toMatchObject({ code: 'FILE_SIZE_MISMATCH' });
  });
});

/** Object-mode поток minio-js: SDK отдаёт async-iterable с `initiated`. */
function uploadStream(items: unknown[]): Readable {
  return Readable.from(items, { objectMode: true });
}

describe('MinioStorageDriver: периодическая уборка (#715)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('перечисляет незавершённые загрузки: ключ, uploadId, дата инициации, байты', async () => {
    const initiated = new Date('2026-11-10T03:00:00.000Z');
    const bucketArgs: unknown[] = [];
    const driver = driverWith({
      listIncompleteUploads: (bucket: string, prefix: string, recursive: boolean) => {
        bucketArgs.push(bucket, prefix, recursive);
        return uploadStream([
          { key: 'files/a', uploadId: 'u-1', size: 1024, initiated },
          { key: 'files/b', uploadId: 'u-2', size: 2048, initiated: 'not-a-date' },
          { prefix: 'общий/' },
        ]);
      },
    });

    const uploads = await driver.listIncompleteUploads();

    expect(bucketArgs).toEqual(['files', '', true]);
    expect(uploads).toEqual([
      { key: 'files/a', uploadId: 'u-1', initiatedAt: initiated, bytes: 1024 },
      // Дата не пришла (или битая) — возраст не доказан, загрузку не тронут.
      { key: 'files/b', uploadId: 'u-2', initiatedAt: null, bytes: 2048 },
    ]);
  });

  it('отменяет конкретную загрузку по uploadId (не поиском по ключу)', async () => {
    const calls: unknown[][] = [];
    const driver = driverWith({
      abortMultipartUpload: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve();
      },
    });

    await driver.abortIncompleteUpload('files/a', 'u-1');

    expect(calls).toEqual([['files', 'files/a', 'u-1']]);
  });

  it('ошибка отмены пробрасывается — sweeper считает failed и повторяет проходом', async () => {
    const driver = driverWith({
      abortMultipartUpload: () => Promise.reject(new Error('S3 down')),
    });

    await expect(driver.abortIncompleteUpload('files/a', 'u-1')).rejects.toThrow('S3 down');
  });
});
