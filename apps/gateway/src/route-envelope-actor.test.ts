import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import type { RealtimeEnvelope } from '@nodus/contracts';

import { routeEnvelope } from './route-envelope.js';
import type { MembershipStore } from './membership.js';

/**
 * Автор действия едет в envelope до клиента (#1051): клиент гасит по нему эхо
 * собственной мутации и не глушит правку коллеги. Отдельный файл — проверка
 * одного поля, а не маршрутизация (она — в route-envelope.test.ts).
 */

const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000a2';

function fakeIo() {
  const calls: { room: string; envelope: RealtimeEnvelope }[] = [];
  const io = {
    to(room: string) {
      return {
        emit(_type: string, envelope: RealtimeEnvelope) {
          calls.push({ room, envelope });
        },
      };
    },
  } as unknown as Server;
  return { io, calls };
}

describe('actorId в envelope (#1051)', () => {
  it('доходит до клиента без изменений — и при вырезании служебной аудитории', async () => {
    const { io, calls } = fakeIo();
    const store: MembershipStore = { isMember: vi.fn(), memberIds: vi.fn(), userRef: vi.fn() };
    const incoming: RealtimeEnvelope = {
      type: 'task.updated',
      payload: { taskId: 't1', audience: [USER_A, USER_B], deciderIds: [USER_B] },
      seq: 1,
      ts: '2026-09-25T00:00:00.000Z',
      actorId: USER_B,
    };

    await routeEnvelope(io, store, incoming);

    expect(calls.map((c) => c.room)).toEqual([`user:${USER_A}`, `user:${USER_B}`]);
    for (const call of calls) {
      // Актёр — в аудитории: своё эхо он гасит по автору события.
      expect(call.envelope.actorId).toBe(USER_B);
      expect(call.envelope.payload).toEqual({ taskId: 't1' });
    }
  });
});
