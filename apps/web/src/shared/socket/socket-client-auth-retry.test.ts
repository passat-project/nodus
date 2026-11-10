// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Хендшейк отвергнут (access истёк) → refresh (ревью #317): удачный —
 * немедленный повтор; неудачный при живой сессии (сеть/5xx/429) — только
 * с экспонентой, иначе петля «хендшейк → refresh» выжигает лимит офиса.
 */

type Handler = (arg?: unknown) => void;
const handlers = new Map<string, Handler>();
const fakeSocket = {
  on: vi.fn((event: string, fn: Handler) => handlers.set(event, fn)),
  connect: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
  io: { opts: {}, engine: { transport: { name: 'websocket' }, once: vi.fn() } },
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../api/api-mock-config.js', () => ({ isDomainMocked: () => false }));

const auth = { status: 'authenticated', accessToken: 't', tryRefresh: vi.fn() };
vi.mock('../auth-store.js', () => ({ useAuthStore: { getState: () => auth } }));

const { connectChatSocket, disconnectChatSocket } = await import('./socket-client.js');

async function rejectHandshake(): Promise<void> {
  handlers.get('connect_error')!(new Error('unauthorized'));
  await vi.waitFor(() => expect(auth.tryRefresh).toHaveBeenCalled());
  await Promise.resolve();
  await Promise.resolve();
}

describe('socket-client: повтор хендшейка после refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.clear();
    vi.clearAllMocks();
    auth.status = 'authenticated';
    connectChatSocket(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    disconnectChatSocket();
    vi.useRealTimers();
  });

  it('refresh удался → немедленный connect', async () => {
    auth.tryRefresh.mockResolvedValue(true);
    await rejectHandshake();
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('refresh не удался, сессия жива (503) → connect не синхронно, а через бэкофф', async () => {
    auth.tryRefresh.mockResolvedValue(false);
    await rejectHandshake();
    expect(fakeSocket.connect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('сессия мертва (anonymous) → повтора нет вовсе', async () => {
    auth.tryRefresh.mockImplementation(async () => {
      auth.status = 'anonymous';
      return false;
    });
    await rejectHandshake();
    vi.advanceTimersByTime(60_000);
    expect(fakeSocket.connect).not.toHaveBeenCalled();
  });

  it('gateway не смог проверить учётку (unavailable, #320) → без refresh, повтор с экспонентой', async () => {
    handlers.get('connect_error')!(new Error('unavailable'));
    expect(auth.tryRefresh).not.toHaveBeenCalled();
    expect(fakeSocket.connect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    // Второй отказ подряд — пауза удваивается.
    handlers.get('connect_error')!(new Error('unavailable'));
    vi.advanceTimersByTime(1_000);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(2);
  });
});
