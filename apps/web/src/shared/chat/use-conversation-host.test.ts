// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const joinConversation = vi.fn();
const leaveConversation = vi.fn();
vi.mock('../socket/socket-client.js', () => ({ joinConversation, leaveConversation }));
const release = vi.fn();
const acquireOpenConversation = vi.fn(() => release);
vi.mock('./open-conversation.js', () => ({ acquireOpenConversation }));

const { useConversationHost } = await import('./use-conversation-host.js');

/** Хост ленты (#351): подписка на WS-комнату + «беседа открыта» для гейта
 *  уведомлений — без комнаты у отправителя не ставятся галочки прочтения. */
describe('useConversationHost', () => {
  beforeEach(() => vi.clearAllMocks());

  it('монтирование — join комнаты и «открыта»; размонтирование — leave и снятие', () => {
    const { unmount } = renderHook(() => useConversationHost('c1'));
    expect(joinConversation).toHaveBeenCalledWith('c1');
    expect(acquireOpenConversation).toHaveBeenCalledWith('c1');

    unmount();
    expect(leaveConversation).toHaveBeenCalledWith('c1');
    expect(release).toHaveBeenCalled();
  });

  it('беседа ещё не загружена (обсуждение задачи до ответа by-task) — ничего', () => {
    renderHook(() => useConversationHost(undefined));
    expect(joinConversation).not.toHaveBeenCalled();
    expect(acquireOpenConversation).not.toHaveBeenCalled();
  });
});
