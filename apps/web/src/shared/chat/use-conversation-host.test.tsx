// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { SurfaceVisibilityProvider } from '../lib/surface-visibility.js';

const joinConversation = vi.fn();
const leaveConversation = vi.fn();
vi.mock('../socket/socket-client.js', () => ({ joinConversation, leaveConversation }));
const release = vi.fn();
const acquireOpenConversation = vi.fn(() => release);
vi.mock('./open-conversation.js', () => ({ acquireOpenConversation }));

const { useConversationHost } = await import('./use-conversation-host.js');

/** Хост ленты (#351): подписка на WS-комнату + «беседа открыта» для гейта
 *  уведомлений — без комнаты у отправителя не ставятся галочки прочтения.
 *  Видимость поверхности (#770): накрытая карточка беседу не открывает. */
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

  it('накрытая поверхность — release; вернулась на вид — снова открыта (#770)', () => {
    let visible = false;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SurfaceVisibilityProvider visible={visible}>{children}</SurfaceVisibilityProvider>
    );
    const { rerender } = renderHook(() => useConversationHost('c1'), { wrapper });
    // WS-комната живёт всегда — без неё не доходят галочки/печатает.
    expect(joinConversation).toHaveBeenCalledWith('c1');
    expect(acquireOpenConversation).not.toHaveBeenCalled();

    visible = true;
    rerender();
    expect(acquireOpenConversation).toHaveBeenCalledTimes(1);

    visible = false;
    rerender();
    expect(release).toHaveBeenCalledTimes(1);

    visible = true;
    rerender();
    expect(acquireOpenConversation).toHaveBeenCalledTimes(2);
  });
});
