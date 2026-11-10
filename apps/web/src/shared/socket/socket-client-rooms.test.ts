// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Комната беседы со счётчиком хостов (#351): одна беседа открыта сразу в
 * мессенджере и в карточке задачи — закрытие одного хоста не выводит
 * другой из комнаты (иначе пропадают прочтения/«печатает…»).
 */

const fakeSocket = {
  on: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
  io: { opts: {}, engine: { transport: { name: 'websocket' }, once: vi.fn() } },
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../api/api-mock-config.js', () => ({ isDomainMocked: () => false }));
vi.mock('../auth-store.js', () => ({
  useAuthStore: { getState: () => ({ status: 'authenticated', accessToken: 't' }) },
}));

const { connectChatSocket, disconnectChatSocket, joinConversation, leaveConversation } =
  await import('./socket-client.js');

const emitted = (event: string) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).length;

describe('socket-client: комната беседы со счётчиком хостов (#351)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectChatSocket(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    disconnectChatSocket();
  });

  it('два хоста одной беседы: один join, leave — только после ухода последнего', () => {
    joinConversation('c1');
    joinConversation('c1');
    expect(emitted('conv:join')).toBe(1);

    leaveConversation('c1');
    expect(emitted('conv:leave')).toBe(0);

    leaveConversation('c1');
    expect(emitted('conv:leave')).toBe(1);
  });

  it('после полного ухода повторное открытие снова входит в комнату', () => {
    joinConversation('c2');
    leaveConversation('c2');
    joinConversation('c2');
    expect(emitted('conv:join')).toBe(2);
  });
});
