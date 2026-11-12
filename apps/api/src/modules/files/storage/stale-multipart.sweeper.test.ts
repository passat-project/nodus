import { describe, expect, it, vi } from 'vitest';

import type { FilesConfig } from '../files.config.js';
import type { IncompleteUploadInfo, MinioStorageDriver } from './minio-storage.driver.js';
import { StaleMultipartSweeper } from './stale-multipart.sweeper.js';
import { staleUploadsSchedule } from './stale-multipart.job.js';

/**
 * Уборка брошенных multipart-загрузок (#715): критерий — ТОЛЬКО возраст из
 * конфига. Свежая загрузка (человек на медленном канале) и загрузка без даты
 * инициации не трогаются; сбой отмены не валит проход.
 */

const HOUR = 3_600_000;
const NOW = new Date('2026-11-12T02:00:00.000Z');

function config(overrides: Partial<FilesConfig> = {}): FilesConfig {
  return {
    endpoint: 'storage.invalid',
    port: 9000,
    useSSL: false,
    bucket: 'files',
    accessKey: 'test',
    secretKey: 'test-secret',
    staleUploadAgeHours: 24,
    staleUploadIntervalHours: 24,
    ...overrides,
  };
}

function upload(overrides: Partial<IncompleteUploadInfo> = {}): IncompleteUploadInfo {
  return {
    key: 'files/11111111-1111-4111-8111-111111111111',
    uploadId: 'upload-1',
    initiatedAt: new Date(NOW.getTime() - 30 * HOUR),
    bytes: 64 * 1024 * 1024,
    ...overrides,
  };
}

function setup(uploads: IncompleteUploadInfo[], cfg: FilesConfig = config()) {
  const storage = {
    listIncompleteUploads: vi.fn().mockResolvedValue(uploads),
    abortIncompleteUpload: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const sweeper = new StaleMultipartSweeper(
    cfg,
    storage as unknown as MinioStorageDriver,
    logger as never,
  );
  return { sweeper, storage, logger };
}

describe('StaleMultipartSweeper.sweepOnce', () => {
  it('отменяет загрузку старше порога из конфига и считает байты', async () => {
    const { sweeper, storage } = setup([upload()]);

    const result = await sweeper.sweepOnce(NOW);

    expect(storage.abortIncompleteUpload).toHaveBeenCalledWith(
      'files/11111111-1111-4111-8111-111111111111',
      'upload-1',
    );
    expect(result).toMatchObject({ scanned: 1, aborted: 1, abortedBytes: 64 * 1024 * 1024 });
  });

  it('не трогает свежую загрузку (честная загрузка в процессе)', async () => {
    const { sweeper, storage } = setup([
      upload({ initiatedAt: new Date(NOW.getTime() - 23 * HOUR) }),
    ]);

    const result = await sweeper.sweepOnce(NOW);

    expect(storage.abortIncompleteUpload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, aborted: 0, skippedFresh: 1 });
  });

  it('порог берётся из конфига, а не из константы: 30 ч при пороге 48 ч — свежая', async () => {
    const { sweeper, storage } = setup([upload()], config({ staleUploadAgeHours: 48 }));

    const result = await sweeper.sweepOnce(NOW);

    expect(storage.abortIncompleteUpload).not.toHaveBeenCalled();
    expect(result.skippedFresh).toBe(1);
  });

  it('граница порога включительна: ровно N часов — брошенная', async () => {
    const { sweeper, storage } = setup([
      upload({ initiatedAt: new Date(NOW.getTime() - 24 * HOUR) }),
    ]);

    await sweeper.sweepOnce(NOW);

    expect(storage.abortIncompleteUpload).toHaveBeenCalledTimes(1);
  });

  it('загрузку без даты инициации не трогает (возраст не доказан)', async () => {
    const { sweeper, storage } = setup([upload({ initiatedAt: null })]);

    const result = await sweeper.sweepOnce(NOW);

    expect(storage.abortIncompleteUpload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skippedUnknownAge: 1, aborted: 0 });
  });

  it('сбой отмены не валит проход: считается failed, остальные обрабатываются', async () => {
    const broken = upload({ key: 'files/broken', uploadId: 'upload-broken' });
    const healthy = upload({ key: 'files/healthy', uploadId: 'upload-healthy' });
    const { sweeper, storage, logger } = setup([broken, healthy]);
    storage.abortIncompleteUpload
      .mockRejectedValueOnce(new Error('S3 down'))
      .mockResolvedValueOnce(undefined);

    const result = await sweeper.sweepOnce(NOW);

    expect(result).toMatchObject({ scanned: 2, aborted: 1, failed: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'files/broken', uploadId: 'upload-broken' }),
      expect.any(String),
    );
  });

  it('пишет метрику прохода в лог (количество и байты)', async () => {
    const { sweeper, logger } = setup([upload(), upload({ key: 'files/fresh', initiatedAt: NOW })]);

    await sweeper.sweepOnce(NOW);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        scanned: 2,
        aborted: 1,
        abortedBytes: 64 * 1024 * 1024,
        skippedFresh: 1,
        maxAgeHours: 24,
      }),
      expect.any(String),
    );
  });
});

describe('staleUploadsSchedule', () => {
  it('интервал расписания — из конфига (раз в сутки по умолчанию)', () => {
    expect(staleUploadsSchedule(config())).toEqual({
      schedulerId: 'stale-multipart-daily',
      jobName: 'sweep',
      everyMs: 24 * HOUR,
    });
  });

  it('период из конфига переводится в миллисекунды', () => {
    expect(staleUploadsSchedule(config({ staleUploadIntervalHours: 6 })).everyMs).toBe(6 * HOUR);
  });
});
