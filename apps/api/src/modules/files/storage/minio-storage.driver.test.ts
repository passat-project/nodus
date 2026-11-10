import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { MinioStorageDriver } from './minio-storage.driver.js';

/**
 * Отмена незавершённой multipart-загрузки при сбое (#713, security-ревью):
 * SDK инициирует multipart до чтения тела и сам её не отменяет — если не
 * позвать abort, залитые части остаются в хранилище навсегда (ключ — UUID,
 * DeleteObject их не видит, повторного «продолжения» не будет).
 */

function driverWith(client: unknown): MinioStorageDriver {
  const driver = new MinioStorageDriver({
    endpoint: 'storage.invalid',
    port: 9000,
    useSSL: false,
    bucket: 'files',
    accessKey: 'test',
    secretKey: 'test-secret',
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
