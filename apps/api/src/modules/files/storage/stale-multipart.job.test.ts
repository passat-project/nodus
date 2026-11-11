import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FilesConfig } from '../files.config.js';
import {
  STALE_UPLOADS_QUEUE,
  STALE_UPLOADS_SCHEDULER_ID,
  StaleMultipartUploadsJob,
  staleUploadsSchedule,
} from './stale-multipart.job.js';

/**
 * Планировщик уборки брошенных multipart-загрузок (#715): очередь
 * `files-stale-uploads`, repeatable-регистрация (Job Scheduler API — upsert по
 * стабильному id) с интервалом из конфига, воркер вызывает sweeper. BullMQ и
 * Redis подменены: проверяем проводку, а не сеть.
 */

const HOUR = 3_600_000;

const queueMock = {
  upsertJobScheduler: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
};
const workerMock = {
  on: vi.fn(),
  close: vi.fn(async () => undefined),
};
let workerProcessor: (() => Promise<void>) | undefined;

vi.mock('bullmq', () => ({
  Queue: class {
    upsertJobScheduler = queueMock.upsertJobScheduler;
    close = queueMock.close;
  },
  Worker: class {
    constructor(
      _name: string,
      processor: () => Promise<void>,
      public readonly opts: unknown,
    ) {
      workerProcessor = processor;
      this.on = workerMock.on;
      this.close = workerMock.close;
    }
    on: typeof workerMock.on;
    close: typeof workerMock.close;
  },
}));

vi.mock('../../../core/redis/redis-connection.js', () => ({
  createRedisClient: () => ({ disconnect: () => undefined }),
  duplicateRedisClient: () => ({ disconnect: () => undefined }),
}));

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

function setup(cfg: FilesConfig = config()) {
  const sweeper = { sweepOnce: vi.fn(async () => ({ aborted: 0 })) };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const job = new StaleMultipartUploadsJob(cfg, sweeper as never, logger as never);
  return { job, sweeper, logger };
}

describe('StaleMultipartUploadsJob: расписание и воркер (#715)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/0';
  });
  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it('регистрирует repeatable-задачу с интервалом из конфига (upsert по стабильному id)', async () => {
    const { job } = setup(config({ staleUploadIntervalHours: 24 }));

    await job.onModuleInit();

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      STALE_UPLOADS_SCHEDULER_ID,
      { every: 24 * HOUR },
      expect.objectContaining({ name: 'sweep' }),
    );
    expect(STALE_UPLOADS_QUEUE).toBe('files-stale-uploads');
  });

  it('период из конфига переводится в миллисекунды', async () => {
    const { job } = setup(config({ staleUploadIntervalHours: 6 }));

    await job.onModuleInit();

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      STALE_UPLOADS_SCHEDULER_ID,
      { every: 6 * HOUR },
      expect.anything(),
    );
    expect(staleUploadsSchedule(config({ staleUploadIntervalHours: 6 })).everyMs).toBe(6 * HOUR);
  });

  it('воркер запускает проход уборки; сбой прохода не роняет воркер', async () => {
    const { job, sweeper, logger } = setup();
    await job.onModuleInit();
    expect(workerProcessor).toBeTypeOf('function');

    await workerProcessor?.();
    expect(sweeper.sweepOnce).toHaveBeenCalledTimes(1);

    // Ошибку прохода проглатывает воркер (повтор — следующим расписанием):
    // failed-слушатель пишет warn.
    sweeper.sweepOnce.mockRejectedValueOnce(new Error('S3 down'));
    await expect(workerProcessor?.()).rejects.toThrow('S3 down');
    const failed = workerMock.on.mock.calls.find(([event]) => event === 'failed')?.[1] as
      ((job: unknown, error: Error) => void) | undefined;
    failed?.(undefined, new Error('S3 down'));
    expect(logger.warn).toHaveBeenCalled();
  });

  it('останавливается чисто: воркер и очередь закрыты, соединение снято', async () => {
    const { job } = setup();
    await job.onModuleInit();

    await job.onModuleDestroy();

    expect(workerMock.close).toHaveBeenCalledTimes(1);
    expect(queueMock.close).toHaveBeenCalledTimes(1);
  });

  it('без REDIS_URL не стартует (fail-fast, как у очередей модуля)', () => {
    delete process.env.REDIS_URL;
    expect(() => setup()).toThrow('REDIS_URL не задан');
  });
});
