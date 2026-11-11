// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ids = vi.hoisted(() => ({
  conv: '00000000-0000-4000-8000-0000000000a1',
}));

const conversation = vi.hoisted(() => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  type: 'task',
  title: 'Задача №1',
  avatarUrl: null,
  myRole: 'member',
  membersPreview: [],
  permissions: {},
  readOnly: false,
}));

vi.mock('../api/chat-api.js', () => ({
  useConversations: () => ({ data: { items: [conversation] }, isError: false }),
}));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useScopedConversations: () => ({ data: { pages: [{ items: [conversation] }] } }),
  useActiveConversation: () => conversation,
}));
vi.mock('../../../shared/api/users-list.js', () => ({
  useUsersList: () => ({ data: { items: [] } }),
}));
vi.mock('../../../shared/chat/conversation-open-responder.js', () => ({
  ConversationOpenResponder: () => null,
}));
vi.mock('./conversation-list.js', () => ({ ConversationList: () => null }));
vi.mock('./chat-workspace.js', () => ({ ChatWorkspace: () => null }));
vi.mock('./chat-create-dialog.js', () => ({ ChatCreateDialog: () => null }));
vi.mock('./chat-settings.js', () => ({ ChatSettings: () => null }));
vi.mock('../../../shared/ui/person-avatar.js', () => ({ PersonAvatar: () => null }));
vi.mock('../../../shared/tasks/task-create-store.js', () => ({ openTaskCreate: vi.fn() }));

import { stageMessengerConversation } from '../../../shared/chat/messenger-nav.js';
import { MessengerBody } from './messenger-body.js';

afterEach(cleanup);

function mount(onTabChange: (tab: 'chats' | 'tasks' | 'settings') => void): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <MessengerBody
      tab="chats"
      conversationId={ids.conv}
      onSelectConversation={vi.fn()}
      threadRootId={null}
      onOpenThread={vi.fn()}
      onCloseThread={vi.fn()}
      onTabChange={onTabChange}
    />,
    { wrapper },
  );
}

describe('MessengerBody (#719)', () => {
  it('внешнее открытие беседы задачи переключает вкладку на «Чаты задач и писем»', () => {
    stageMessengerConversation(ids.conv);
    const onTabChange = vi.fn();

    mount(onTabChange);

    expect(onTabChange).toHaveBeenCalledWith('tasks');
  });
});
