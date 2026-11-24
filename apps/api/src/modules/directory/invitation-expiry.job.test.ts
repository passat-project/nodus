import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvitationExpiryJob, INVITATION_EXPIRY_QUEUE } from './invitation-expiry.job.js';

/** Проводка часового истечения приглашений (#101): BullMQ/Redis подменены. */

const queueMock = {
  upsertJobScheduler: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
};
const workerMock = {
  on: vi.fn(),
  close: vi.fn(async () => undefined),
};

vi.mock('bullmq', () => ({
  Queue: class {
    upsertJobScheduler = queueMock.upsertJobScheduler;
    close = queueMock.close;
  },
  Worker: class {
    constructor(
      public readonly name: string,
      public readonly processor: () => Promise<void>,
      public readonly opts: unknown,
    ) {
      this.on = workerMock.on;
      this.close = workerMock.close;
    }
    on: typeof workerMock.on;
    close: typeof workerMock.close;
  },
}));

vi.mock('../../core/redis/redis-connection.js', () => ({
  createRedisClient: () => ({ disconnect: () => undefined }),
  duplicateRedisClient: () => ({ disconnect: () => undefined }),
}));

describe('InvitationExpiryJob (#101)', () => {
  const service = {
    expireInvitations: vi.fn(async () => [
      { userId: 'new-user', removed: true },
      { userId: 'former', removed: false },
    ]),
  };
  const audit = { append: vi.fn(async () => undefined) };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/1';
    service.expireInvitations.mockResolvedValue([
      { userId: 'new-user', removed: true },
      { userId: 'former', removed: false },
    ]);
  });

  it('runOnce истекает пачку и пишет аудит с actorId=null', async () => {
    const job = new InvitationExpiryJob(service as never, audit as never, logger as never);
    await expect(job.runOnce()).resolves.toBe(2);
    expect(service.expireInvitations).toHaveBeenCalledWith(50);
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenCalledWith({
      actorId: null,
      action: 'directory.invitation.expire',
      entityType: 'user',
      entityId: 'new-user',
      details: { removed: true },
    });
  });

  it('регистрирует часовое расписание и воркер, закрывается штатно', async () => {
    const job = new InvitationExpiryJob(service as never, audit as never, logger as never);
    await job.onModuleInit();
    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      'invitation-expiry-hourly',
      { pattern: '0 * * * *' },
      expect.objectContaining({ name: 'expire' }),
    );
    expect(INVITATION_EXPIRY_QUEUE).toBe('directory-invitation-expiry');
    await job.onModuleDestroy();
    expect(workerMock.close).toHaveBeenCalled();
    expect(queueMock.close).toHaveBeenCalled();
  });
});
