import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditRepository } from '../../src/core/audit/audit.repository.js';
import { PrismaService } from '../../src/core/database/prisma.service.js';
import { TransactionRunner } from '../../src/core/database/transaction-runner.js';
import { EventBus } from '../../src/core/events/event-bus.js';
import { FilesRepository } from '../../src/modules/files/files.repository.js';
import { getFilesConfig, type FilesConfig } from '../../src/modules/files/files.config.js';
import { MinioStorageDriver } from '../../src/modules/files/storage/minio-storage.driver.js';
import {
  getOfficeConfig,
  type OfficeConfig,
} from '../../src/modules/files/office/office.config.js';
import {
  OfficeCallbackService,
  type OfficeCallbackBody,
} from '../../src/modules/files/office/office-callback.service.js';
import { OfficeTokenService } from '../../src/modules/files/office/office-token.service.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Конкурентные сохранения ONLYOFFICE (AUD-015, #866) на живых PostgreSQL и S3
 * (SILO): два параллельных колбэка с разным содержимым обязаны стать двумя
 * версиями, каждая — со своим объектом; размер объекта равен размеру в строке
 * версии; повтор того же колбэка версию не плодит.
 *
 * Сервис собирается напрямую (без Nest): замок строки, транзакция и outbox —
 * настоящие; DS-скачивание подменено stub-ом fetch (два разных тела).
 */

const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BYTES_A = new Uint8Array([1, 2, 3]);
const BYTES_B = new Uint8Array([4, 5, 6, 7, 8, 9, 10]);

/** Минимальный журнал: PinoLogger-интерфейс только в используемой части. */
const logger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.STORAGE_ACCESS_KEY)(
  'files: конкурентные сохранения ONLYOFFICE (integration, AUD-015)',
  () => {
    let prisma: PrismaService;
    let repository: FilesRepository;
    let driver: MinioStorageDriver;
    let service: OfficeCallbackService;
    let filesConfig: FilesConfig;
    let officeConfig: OfficeConfig;
    const createdIds: string[] = [];

    beforeAll(async () => {
      const url = await ensureTestDatabase(`${__dirname}/../..`);
      process.env.DATABASE_URL = url;
      prisma = new PrismaService();
      await prisma.$connect();
      repository = new FilesRepository(prisma);
      filesConfig = getFilesConfig();
      officeConfig = getOfficeConfig();
      driver = new MinioStorageDriver(filesConfig);
      await driver.onModuleInit();
      service = new OfficeCallbackService(
        repository,
        driver,
        new TransactionRunner(prisma),
        new EventBus(),
        new AuditRepository(prisma),
        new OfficeTokenService(officeConfig),
        { enqueuePdf: async () => undefined } as never,
        officeConfig,
        logger as never,
      );
    }, 120_000);

    afterAll(async () => {
      if (prisma) {
        const objects = await prisma.fileObject.findMany({
          where: { id: { in: createdIds } },
          select: { key: true, versions: { select: { key: true } } },
        });
        const keys = objects.flatMap((object) => [
          object.key,
          ...object.versions.map((version) => version.key),
        ]);
        await driver?.remove(keys).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
        await prisma.event.deleteMany({ where: { aggregateId: { in: createdIds } } });
        await prisma.fileObject.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.$disconnect();
      }
      vi.unstubAllGlobals();
    }, 60_000);

    async function createFile(): Promise<string> {
      const id = randomUUID();
      await repository.createWithVersion({
        id,
        ownerId: randomUUID(),
        bucket: filesConfig.bucket,
        key: `files/${id}`,
        name: 'Смета.docx',
        mime: MIME,
        size: 100,
      });
      createdIds.push(id);
      return id;
    }

    function stubDownloads(): void {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
          const body = new URL(input).pathname.endsWith('/a') ? BYTES_A : BYTES_B;
          return new Response(body, {
            status: 200,
            headers: { 'content-length': String(body.length) },
          });
        }),
      );
    }

    function callback(key: string, path: 'a' | 'b', lastsave: string): OfficeCallbackBody {
      return {
        status: 2,
        key,
        url: `https://nodus.by/cache/files/data/xxx/${path}?expires=999`,
        lastsave,
        filetype: 'docx',
      };
    }

    async function objectBytes(key: string): Promise<Buffer> {
      const chunks: Buffer[] = [];
      for await (const chunk of await driver.get(key)) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    }

    it('два параллельных колбэка с разным содержимым — обе версии сохранены, размеры совпадают', async () => {
      stubDownloads();
      const fileId = await createFile();
      const documentKey = `${fileId}.v1`;

      await Promise.all([
        service.handle(fileId, callback(documentKey, 'a', '2026-11-16T18:00:00.000Z')),
        service.handle(fileId, callback(documentKey, 'b', '2026-11-16T18:05:00.000Z')),
      ]);

      const versions = await repository.findVersions(fileId);
      const saved = versions.filter((version) => version.version >= 2);
      expect(saved.map((version) => version.version).sort()).toEqual([2, 3]);
      // Объекты попыток уникальны: содержимое версии — её собственный объект.
      expect(new Set(saved.map((version) => version.key)).size).toBe(2);
      expect(saved.map((version) => version.size).sort()).toEqual([BYTES_A.length, BYTES_B.length]);
      for (const row of saved) {
        expect((await objectBytes(row.key)).length).toBe(row.size);
      }
      // Указатель файла — на самую позднюю версию, и он согласован с её строкой.
      const fresh = await repository.findById(fileId);
      expect(fresh?.version).toBe(3);
      expect(fresh?.key).toBe(versions[0]?.key);
      expect(fresh?.size).toBe(versions[0]?.size);
    }, 60_000);

    it('повтор того же колбэка не создаёт новую версию', async () => {
      stubDownloads();
      const fileId = await createFile();
      const body = callback(`${fileId}.v1`, 'a', '2026-11-16T19:00:00.000Z');

      await service.handle(fileId, body);
      await service.handle(fileId, body);

      const versions = await repository.findVersions(fileId);
      expect(versions.map((version) => version.version)).toEqual([2, 1]);
    }, 60_000);
  },
);
