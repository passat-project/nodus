// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem } from '@nodus/contracts';

const h = vi.hoisted(() => ({
  copy: vi.fn(async () => undefined),
  conversation: {
    id: 'c-task',
    type: 'task',
    title: 'Задача №1',
    avatarUrl: null,
    myRole: 'member',
    membersPreview: [],
    membersCount: 2,
    permissions: {},
    draft: null,
    visibility: null,
    description: null,
    project: null,
    task: null,
    letter: null,
    lastMessage: null,
    lastActivityAt: null,
    unreadCount: 0,
    myLastReadSeq: 0,
    pinned: false,
    muted: false,
    snoozed: false,
  } as unknown as ConversationListItem,
}));

vi.mock('./chat-queries.js', () => ({
  useConversations: () => ({ data: { items: [h.conversation] } }),
}));
vi.mock('./conversation-actions.js', () => ({
  useUpdateConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./conversation-subtitle.js', () => ({ useConversationSubtitle: () => 'подпись' }));
vi.mock('./vault-api.js', () => ({ useConversationVaultCounts: () => ({ data: null }) }));
vi.mock('./conversations.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./conversations.js')>()),
  conversationTitle: () => 'Задача №1',
}));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { ChatProfilePane } from './chat-profile-pane.js';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: h.copy },
  });
});

afterEach(cleanup);

describe('ChatProfilePane — копирование ссылки (#1062)', () => {
  it('ссылка несёт вкладку по типу беседы', async () => {
    render(
      <ChatProfilePane
        conversationId={h.conversation.id}
        conversation={h.conversation}
        onOpenVaultType={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Копировать ссылку/ }));
    await waitFor(() =>
      expect(h.copy).toHaveBeenCalledWith(`${window.location.origin}/chat/c-task?tab=tasks`),
    );
  });
});
