import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_EVENTS } from '@nodus/contracts';

import { LetterDeletedNotifyHandler } from './letter-deleted.handler.js';
import { NotificationsService } from '../notifications.service.js';

const LETTER = '11111111-1111-1111-1111-111111111111';
const ALICE = '22222222-2222-2222-2222-222222222222';
const BOB = '33333333-3333-3333-3333-333333333333';
const TX = 'tx-handle';

const event = (payload: Record<string, unknown>) => ({ payload }) as never;

describe('LetterDeletedNotifyHandler (AUD-011)', () => {
  const service = { purgeBySource: vi.fn() };
  const featureFlags = { isEnabled: vi.fn() };
  let handler: LetterDeletedNotifyHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    featureFlags.isEnabled.mockResolvedValue(true);
    handler = new LetterDeletedNotifyHandler(service as never, featureFlags as never);
  });

  it('удаляет уведомления письма у всех получателей (по источнику letter)', async () => {
    await handler.handle(event({ letterId: LETTER }));
    expect(service.purgeBySource).toHaveBeenCalledWith('letter', LETTER);
    expect(service.purgeBySource).toHaveBeenCalledTimes(1);
  });

  it('флаг notifications выключен — тишина', async () => {
    featureFlags.isEnabled.mockResolvedValue(false);
    await handler.handle(event({ letterId: LETTER }));
    expect(service.purgeBySource).not.toHaveBeenCalled();
  });

  it('payload без letterId — тихий пропуск', async () => {
    await handler.handle(event({}));
    expect(service.purgeBySource).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.purgeBySource', () => {
  const repo = { deleteBySource: vi.fn() };
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

  it('удаляет строки письма и эмитит notification.read каждому затронутому получателю', async () => {
    repo.deleteBySource.mockResolvedValue([ALICE, BOB]);
    const affected = await service.purgeBySource('letter', LETTER);
    expect(repo.deleteBySource).toHaveBeenCalledWith('letter', LETTER, TX);
    expect(affected).toBe(2);
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      NOTIFICATION_EVENTS.READ,
      expect.objectContaining({ userId: ALICE, sourceId: LETTER, notificationIds: null }),
      expect.objectContaining({ aggregateType: 'notification' }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      NOTIFICATION_EVENTS.READ,
      expect.objectContaining({ userId: BOB, sourceId: LETTER, notificationIds: null }),
      expect.objectContaining({ aggregateType: 'notification' }),
    );
  });

  it('дедуп user_id: несколько строк одного получателя — один эмит', async () => {
    repo.deleteBySource.mockResolvedValue([ALICE, ALICE]);
    const affected = await service.purgeBySource('letter', LETTER);
    expect(affected).toBe(1);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('идемпотентно: повтор события после чистки — 0 строк, 0 эмитов', async () => {
    repo.deleteBySource.mockResolvedValue([]);
    const affected = await service.purgeBySource('letter', LETTER);
    expect(affected).toBe(0);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
