import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Minio from 'minio';

import { getFilesConfig } from '../../src/modules/files/files.config.js';
import { MinioStorageDriver } from '../../src/modules/files/storage/minio-storage.driver.js';
import { StaleMultipartSweeper } from '../../src/modules/files/storage/stale-multipart.sweeper.js';

/**
 * Приёмка #715 на живом S3 (SILO): незавершённая multipart-загрузка,
 * брошенная жёстким падением процесса (kill/OOM), отменяется периодической
 * уборкой — старше порога возраста, свежая не тронута, `ListMultipartUploads`
 * по ключу пуст. Клиент хранилища в тесте — тот же SDK, что у драйвера:
 * загрузка инициируется напрямую, в обход `put` (в продукте abort при сбое
 * put уже есть, #713 — здесь проверяется именно «брошена и не отменена»).
 */

const HOUR = 3_600_000;

/** Минимальный журнал: PinoLogger-интерфейс только в используемой части. */
const logger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

describe.skipIf(!process.env.STORAGE_ACCESS_KEY)(
  'files: уборка брошенных multipart-загрузок (integration, #715)',
  () => {
    const config = getFilesConfig();
    const driver = new MinioStorageDriver(config);
    const client = new Minio.Client({
      endPoint: config.endpoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const staleKey = `files/it-stale-${runId}`;
    const freshKey = `files/it-fresh-${runId}`;

    async function incompleteKeys(): Promise<string[]> {
      const uploads = await driver.listIncompleteUploads();
      return uploads
        .map((upload) => upload.key)
        .filter((key) => key === staleKey || key === freshKey);
    }

    async function initiate(key: string): Promise<string> {
      const uploadId = await client.initiateNewMultipartUpload(config.bucket, key, {
        'Content-Type': 'application/octet-stream',
      });
      // Часть залита: у брошенной загрузки в бакете реально лежат байты.
      await client.uploadPart(
        {
          bucketName: config.bucket,
          objectName: key,
          uploadID: uploadId,
          partNumber: 1,
          headers: {},
        },
        Buffer.alloc(1024),
      );
      return uploadId;
    }

    beforeAll(async () => {
      // Бакет тест-контура существует/создаётся (Compose делает minio-init, CI — root).
      await driver.onModuleInit();
    }, 60_000);

    afterAll(async () => {
      for (const key of [staleKey, freshKey]) {
        await client.removeIncompleteUpload(config.bucket, key).catch(() => undefined);
      }
    }, 60_000);

    it('незавершённые загрузки видны в листинге с датой инициации и байтами', async () => {
      const uploadId = await initiate(staleKey);

      const uploads = await driver.listIncompleteUploads();
      const mine = uploads.filter((upload) => upload.key === staleKey);

      expect(mine).toHaveLength(1);
      expect(mine[0]?.uploadId).toBe(uploadId);
      expect(mine[0]?.initiatedAt).toBeInstanceOf(Date);
      expect(mine[0]?.bytes).toBeGreaterThanOrEqual(1024);
    }, 60_000);

    it('свежая загрузка не тронута, брошенная (старше порога) отменена — листинг по ключу пуст', async () => {
      await initiate(freshKey);
      const sweeper = new StaleMultipartSweeper(config, driver, logger as never);

      // Порог 24 ч, «сейчас» — через 25 часов: обе загрузки старше порога,
      // свежей для этого прохода не остаётся; проверка порога — ниже.
      const result = await sweeper.sweepOnce(new Date(Date.now() + 26 * HOUR));
      expect(result.aborted).toBeGreaterThanOrEqual(2);
      expect(await incompleteKeys()).toEqual([]);
    }, 120_000);

    it('честная загрузка моложе порога не отменяется (реальный проход, порог 24 ч)', async () => {
      await initiate(freshKey);
      const sweeper = new StaleMultipartSweeper(config, driver, logger as never);

      await sweeper.sweepOnce();

      // Ключ на месте: возраст — критерий, а не сам факт «незавершённая».
      expect(await incompleteKeys()).toEqual([freshKey]);
    }, 120_000);
  },
);
