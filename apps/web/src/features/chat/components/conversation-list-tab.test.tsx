// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { openInNewTab } from '../../../shared/lib/tab-bridge.js';
import { ConversationList } from './conversation-list.js';

vi.mock('../../../shared/desktop/desktop-bridge.js', () => ({ isDesktopShell: () => true }));
vi.mock('../../../shared/lib/tab-bridge.js', () => ({ openInNewTab: vi.fn() }));

const ME = '00000000-0000-4000-8000-000000000001';

const taskConversation = {
  id: 'c-task',
  type: 'task',
  title: 'Задача №1',
  avatarUrl: null,
  myRole: 'member',
  permissions: {
    changeInfo: 'admin',
    addMembers: 'member',
    removeMembers: 'admin',
    post: 'member',
    manageSettings: 'owner',
  },
  draft: null,
  visibility: null,
  description: null,
  project: null,
  task: null,
  letter: null,
  membersPreview: [],
  membersCount: 2,
  lastMessage: null,
  lastActivityAt: null,
  unreadCount: 0,
  myLastReadSeq: 0,
  pinned: false,
  muted: false,
  snoozed: false,
} as ConversationListItem;

beforeEach(() => {
  useAuthStore.setState({
    user: { id: ME, displayName: 'Я', email: 'me@nodus.by', permissions: [] },
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
  vi.clearAllMocks();
});

/** #1062: средний клик в оболочке открывает новую вкладку сразу на списке
 *  своей вкладки — адрес несёт `?tab=tasks` для чата задачи. */
describe('ConversationList — вкладка новой вкладки портала (#1062)', () => {
  it('средний клик по чату задачи: ?tab=tasks в адресе', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { container } = render(
      <ConversationList conversations={[taskConversation]} isLoading={false} onSelect={() => {}} />,
      { wrapper },
    );
    const row = container.querySelector('button[data-row]')!;
    fireEvent(row, new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(openInNewTab).toHaveBeenCalledWith('/chat/c-task?tab=tasks', { focus: false });
  });
});
