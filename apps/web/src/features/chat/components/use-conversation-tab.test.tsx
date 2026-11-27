// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  conversation: undefined as { id: string; type: string } | undefined,
}));

vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useConversationById: () => h.conversation,
}));

import { useConversationTab } from './use-conversation-tab.js';

/** #1062: вкладка карточки мессенджера — по типу беседы, ручной выбор живёт. */

function mount(id: string) {
  return renderHook(
    ({ conversationId }: { conversationId: string }) => useConversationTab(conversationId),
    {
      initialProps: { conversationId: id },
    },
  );
}

describe('useConversationTab (#1062)', () => {
  it('F5-восстановление: тип беседы разрешился — вкладка «Чаты задач и писем»', () => {
    h.conversation = undefined;
    const { result, rerender } = mount('c-task');
    expect(result.current[0]).toBe('chats');

    h.conversation = { id: 'c-task', type: 'task' };
    rerender({ conversationId: 'c-task' });
    expect(result.current[0]).toBe('tasks');
  });

  it('ручной выбор не перебивается, пока беседа та же', () => {
    h.conversation = { id: 'c-task', type: 'task' };
    const { result, rerender } = mount('c-task');
    expect(result.current[0]).toBe('tasks');

    act(() => result.current[1]('chats'));
    expect(result.current[0]).toBe('chats');

    // Рефеч/перерисовка той же беседы ручной выбор не отменяет.
    rerender({ conversationId: 'c-task' });
    expect(result.current[0]).toBe('chats');
  });

  it('смена беседы сбрасывает ручной выбор и берёт вкладку новой', () => {
    h.conversation = { id: 'c-task', type: 'task' };
    const { result, rerender } = mount('c-task');
    act(() => result.current[1]('chats'));

    h.conversation = { id: 'c-direct', type: 'direct' };
    rerender({ conversationId: 'c-direct' });
    expect(result.current[0]).toBe('chats');

    h.conversation = { id: 'c-letter', type: 'letter' };
    rerender({ conversationId: 'c-letter' });
    expect(result.current[0]).toBe('tasks');
  });
});
