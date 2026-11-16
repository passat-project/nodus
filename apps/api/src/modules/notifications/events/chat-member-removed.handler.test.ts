import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_EVENTS } from '@nodus/contracts';

import { ChatMemberRemovedNotifyHandler } from './chat-member-removed.handler.js';
import { NotificationsService } from '../notifications.service.js';

const CONV = '11111111-1111-1111-1111-111111111111';
const REMOVED = '22222222-2222-2222-2222-222222222222';
const STAYED = '33333333-3333-3333-3333-333333333333';
const TX = 'tx-handle';

const event = (payload: Record<string, unknown>) => ({ payload }) as never;

describe('ChatMemberRemovedNotifyHandler (AUD-011)', () => {
  const service = { purgeBySourceForUsers: vi.fn() };
  const featureFlags = { isEnabled: vi.fn() };
  let handler: ChatMemberRemovedNotifyHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    featureFlags.isEnabled.mockResolvedValue(true);
    handler = new ChatMemberRemovedNotifyHandler(service as never, featureFlags as never);
  });

  it('чистит уведомления беседы только у исключённого — остальные участники не тронуты', async () => {
    await handler.handle(event({ conversationId: CONV, userId: REMOVED, actorId: STAYED }));
    expect(service.purgeBySourceForUsers).toHaveBeenCalledWith('conversation', CONV, [REMOVED]);
    expect(service.purgeBySourceForUsers).toHaveBeenCalledTimes(1);
  });

  it('флаг notifications выключен — тишина (чат жив)', async () => {
    featureFlags.isEnabled.mockResolvedValue(false);
    await handler.handle(event({ conversationId: CONV, userId: REMOVED }));
    expect(service.purgeBySourceForUsers).not.toHaveBeenCalled();
  });

  it('payload без conversationId/userId — тихий пропуск', async () => {
    await handler.handle(event({ userId: REMOVED }));
    await handler.handle(event({ conversationId: CONV }));
    expect(service.purgeBySourceForUsers).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.purgeBySourceForUsers', () => {
  const repo = { deleteBySourceForUsers: vi.fn() };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const service = new NotificationsService(
    repo as never,
    txRunner as never,
    eventBus as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('удаляет строки беседы у исключённого и эмитит notification.read ему', async () => {
    repo.deleteBySourceForUsers.mockResolvedValue([REMOVED]);
    const affected = await service.purgeBySourceForUsers('conversation', CONV, [REMOVED]);
    expect(repo.deleteBySourceForUsers).toHaveBeenCalledWith('conversation', CONV, [REMOVED], TX);
    expect(affected).toBe(1);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      NOTIFICATION_EVENTS.READ,
      expect.objectContaining({ userId: REMOVED, sourceId: CONV, notificationIds: null }),
      expect.objectContaining({ aggregateType: 'notification' }),
    );
  });

  it('чужие строки не затрагиваются: репозиторий получает только исключённого', async () => {
    repo.deleteBySourceForUsers.mockResolvedValue([]);
    await service.purgeBySourceForUsers('conversation', CONV, [REMOVED]);
    const [, , userIds] = repo.deleteBySourceForUsers.mock.calls[0] as [
      string,
      string,
      string[],
      string,
    ];
    expect(userIds).toEqual([REMOVED]);
    expect(userIds).not.toContain(STAYED);
  });

  it('идемпотентно: нечего чистить — 0 эмитов', async () => {
    repo.deleteBySourceForUsers.mockResolvedValue([]);
    const affected = await service.purgeBySourceForUsers('conversation', CONV, [REMOVED]);
    expect(affected).toBe(0);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('пустой список пользователей — репозиторий не вызывается', async () => {
    await expect(service.purgeBySourceForUsers('conversation', CONV, [])).resolves.toBe(0);
    expect(repo.deleteBySourceForUsers).not.toHaveBeenCalled();
  });
});
