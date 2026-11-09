// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

vi.mock('./chat-queries.js', () => ({
  useConversations: () => ({
    data: {
      items: [
        {
          id: 'conv-1',
          membersPreview: [{ id: 'user-2', displayName: 'Петров Пётр Петрович' }],
        },
      ],
    },
  }),
}));

import { useAuthStore } from '../auth-store.js';
import { useTypingStore } from '../socket/typing-store.js';

import { useThreadTyping } from './use-thread-typing.js';

afterEach(() => {
  cleanup();
  useTypingStore.getState().reset();
  useAuthStore.setState({ user: null });
});

describe('«печатает в обсуждении…» (#104, #496)', () => {
  it('свежая запись другого человека — имя без отчества и подпись', () => {
    useAuthStore.setState({
      user: { id: 'user-1', displayName: 'Я', permissions: [] },
    } as never);
    useTypingStore.getState().touch('conv-1', 'user-2', 'root-1');

    const { result } = renderHook(() => useThreadTyping('conv-1', 'root-1'));

    expect(result.current).toBe(`Петров Пётр ${ui.chat.typingThread}`);
  });

  it('своя печать и просроченная запись не показываются', () => {
    useAuthStore.setState({
      user: { id: 'user-2', displayName: 'Я', permissions: [] },
    } as never);
    useTypingStore.getState().touch('conv-1', 'user-2', 'root-1');

    const mine = renderHook(() => useThreadTyping('conv-1', 'root-1'));
    expect(mine.result.current).toBeNull();
    mine.unmount();

    useAuthStore.setState({
      user: { id: 'user-1', displayName: 'Я', permissions: [] },
    } as never);
    useTypingStore.setState({
      entries: { 'conv-1:root-1': { userId: 'user-2', expiresAt: Date.now() - 1 } },
    });
    const stale = renderHook(() => useThreadTyping('conv-1', 'root-1'));
    expect(stale.result.current).toBeNull();
  });

  it('имени в составе беседы нет — только подпись', () => {
    useTypingStore.getState().touch('conv-1', 'user-404', 'root-1');

    const { result } = renderHook(() => useThreadTyping('conv-1', 'root-1'));

    expect(result.current).toBe(ui.chat.typingThread);
  });
});
