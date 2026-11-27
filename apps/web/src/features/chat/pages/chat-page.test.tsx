// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface BodyProps {
  onSelectConversation: (id: string, type?: string) => void;
  onOpenConversation: (id: string, threadRootId: string | null) => void;
}

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: {} as Record<string, unknown>,
  conversation: undefined as { id: string; type: string } | undefined,
  cache: {} as Record<string, { type: string }>,
  bodyProps: undefined as unknown as BodyProps,
  tabs: [] as string[],
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
  useParams: () => ({ conversationId: 'c-task' }),
  useSearch: () => h.search,
}));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useConversationById: () => h.conversation,
  cachedConversation: (_client: unknown, id: string) => h.cache[id],
}));
vi.mock('../../../shared/chat/conversations.js', () => ({
  conversationTitle: () => 'Задача №1',
}));
vi.mock('../../../shared/desktop/desktop-bridge.js', () => ({ isDesktopShell: () => false }));
vi.mock('../../../shared/lib/tab-bridge.js', () => ({ setPortalTabTitle: vi.fn() }));
vi.mock('../components/messenger-body.js', () => ({
  MessengerBody: (props: BodyProps & { tab: string }) => {
    h.tabs.push(props.tab);
    h.bodyProps = props;
    return null;
  },
}));

import { ChatPage } from './chat-page.js';

/** #1062: вкладка страницы /chat — по типу беседы без `?tab=`, адрес
 *  нормализуется; явный ?tab= (ручной выбор) главнее. */

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  h.navigate.mockReset();
  h.search = {};
  h.conversation = undefined;
  h.cache = {};
  h.tabs.length = 0;
});

describe('ChatPage — вкладка по типу беседы (#1062)', () => {
  it('deep-link на чат задачи без ?tab: вкладка «Чаты задач», адрес нормализован', async () => {
    h.conversation = { id: 'c-task', type: 'task' };
    mount();

    expect(h.tabs.at(-1)).toBe('tasks');
    await waitFor(() => expect(h.navigate).toHaveBeenCalledTimes(1));
    const call = h.navigate.mock.calls[0]![0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.replace).toBe(true);
    // Прочие параметры (стек карточек) сохраняются.
    expect(call.search({ cards: 'messenger:c-task' })).toEqual({
      cards: 'messenger:c-task',
      tab: 'tasks',
    });
  });

  it('явный ?tab= главнее типа: ручной выбор не перебивается', () => {
    h.search = { tab: 'chats' };
    h.conversation = { id: 'c-task', type: 'task' };
    mount();

    expect(h.tabs.at(-1)).toBe('chats');
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('личная беседа: «Чаты», адрес не трогаем', () => {
    h.conversation = { id: 'c-task', type: 'direct' };
    mount();

    expect(h.tabs.at(-1)).toBe('chats');
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('выбор беседы из списка: вкладка — по её типу, тред старой беседы снят', () => {
    h.search = { tab: 'chats' };
    h.conversation = { id: 'c-task', type: 'task' };
    mount();
    h.navigate.mockClear();

    act(() => h.bodyProps.onSelectConversation('c-next', 'letter'));
    const call = h.navigate.mock.calls[0]![0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    // `cards` (стек карточек) живёт, `thread`/старый `tab` — нет.
    expect(call.search({ cards: 'messenger:c-next', thread: 'old', tab: 'chats' })).toEqual({
      cards: 'messenger:c-next',
      tab: 'tasks',
    });

    act(() => h.bodyProps.onSelectConversation('c-direct', 'direct'));
    const direct = h.navigate.mock.calls[1]![0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(direct.search({ cards: 'x', tab: 'tasks' })).toEqual({ cards: 'x' });
  });

  it('внутренний переход (пересылка/цитата): вкладка типа цели и её тред', () => {
    h.search = { tab: 'chats' };
    h.cache = { 'c-letter': { type: 'letter' } };
    mount();
    h.navigate.mockClear();

    act(() => h.bodyProps.onOpenConversation('c-letter', 'root-1'));
    const call = h.navigate.mock.calls[0]![0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ cards: 'messenger:x', tab: 'chats' })).toEqual({
      cards: 'messenger:x',
      tab: 'tasks',
      thread: 'root-1',
    });

    // Тип цели ещё не разрешён: `tab` снимается, страница выведет его сама.
    act(() => h.bodyProps.onOpenConversation('c-unknown', 'root-2'));
    const unknown = h.navigate.mock.calls[1]![0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(unknown.search({ cards: 'x', tab: 'chats' })).toEqual({
      cards: 'x',
      thread: 'root-2',
    });
  });
});
