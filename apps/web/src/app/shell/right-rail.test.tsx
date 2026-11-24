// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, Paginated } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

// Роутер (useRailHidden/useCardStack) — вне RouterProvider подменяем:
// useRouterState возвращает результат select по реальной сигнатуре.
vi.mock('@tanstack/react-router', () => ({
  useRouterState: (opts?: { select?: (s: unknown) => unknown }) =>
    opts?.select
      ? opts.select({ location: { pathname: '/home' } })
      : { location: { pathname: '/home' } },
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { chatKeys } from '../../shared/chat/chat-keys.js';
import { useAuthStore } from '../../shared/auth-store.js';
import { RightRail } from './right-rail.js';

/**
 * Служебная полоса после #1021: только список бесед до низа — кнопки робота
 * внизу больше нет (вход в ассистента — топбар) и служебного градиента-
 * затухания над ней тоже.
 */

const conversation = (): ConversationListItem =>
  ({
    id: 'c1',
    type: 'group',
    title: 'Рабочая беседа',
    unreadCount: 0,
    snoozed: false,
    myLastReadSeq: 1,
    lastMessage: null,
    pinned: false,
    readOnly: false,
  }) as ConversationListItem;

afterEach(cleanup);

function renderRail(items: ConversationListItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), {
    items,
    nextCursor: null,
  });
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test',
    user: { id: 'me-1', email: 'me@nodus.by', displayName: 'Я Сам', permissions: [] },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RightRail />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('RightRail — список бесед без входа ассистента (#1021)', () => {
  it('беседы рендерятся строками с тултипом имени', () => {
    renderRail([conversation(), { ...conversation(), id: 'c2', title: 'Вторая беседа' }]);
    expect(screen.getByTitle('Рабочая беседа')).toBeTruthy();
    expect(screen.getByTitle('Вторая беседа')).toBeTruthy();
  });

  it('кнопки-робота внизу полосы НЕТ (вход — топбар) и градиента-затухания тоже', () => {
    renderRail([conversation()]);
    expect(screen.queryByRole('button', { name: ui.assistant.openHint })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.assistant.close })).toBeNull();
    expect(document.querySelector('.bg-gradient-to-t')).toBeNull();
  });

  it('чат задачи в полосу не попадает (экспресс-мессенджер: кроме чатов задач)', () => {
    renderRail([
      conversation(),
      { ...conversation(), id: 't1', type: 'task', title: 'Чат задачи' },
    ]);
    expect(screen.getByTitle('Рабочая беседа')).toBeTruthy();
    expect(screen.queryByTitle('Чат задачи')).toBeNull();
  });
});
