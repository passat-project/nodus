import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import type { RealtimeEnvelope } from '@nodus/contracts';

import {
  routeEnvelope,
  USER_PASSWORD_CHANGED_EVENT,
  USER_PASSWORD_RESET_ISSUED_EVENT,
} from './route-envelope.js';
import type { MembershipStore } from './membership.js';

/** Парольные события (#101): доступ закрывается сразу, включая реалтайм —
 *  выпуск reset-ссылки и фактическая смена пароля рвут сокеты пользователя. */
describe('routeEnvelope: парольные события (#101)', () => {
  const USER = '00000000-0000-4000-8000-0000000000a1';

  function envelope(type: string, payload: Record<string, unknown>): RealtimeEnvelope {
    return { type, payload, seq: 1, ts: '2026-11-24T00:00:00.000Z' };
  }

  it('password_reset_issued и password_changed отключают сокеты с закрытием транспорта', async () => {
    const disconnectSockets = vi.fn();
    const inRoom = vi.fn(() => ({ disconnectSockets }));
    const io = { in: inRoom } as unknown as Server;
    const store: MembershipStore = { isMember: vi.fn(), memberIds: vi.fn(), userRef: vi.fn() };

    await routeEnvelope(io, store, envelope(USER_PASSWORD_RESET_ISSUED_EVENT, { userId: USER }));

    expect(inRoom).toHaveBeenCalledWith(`user:${USER}`);
    expect(disconnectSockets).toHaveBeenCalledWith(true);

    await routeEnvelope(io, store, envelope(USER_PASSWORD_CHANGED_EVENT, { userId: USER }));

    expect(inRoom).toHaveBeenCalledTimes(2);
    expect(disconnectSockets).toHaveBeenCalledTimes(2);
  });
});
