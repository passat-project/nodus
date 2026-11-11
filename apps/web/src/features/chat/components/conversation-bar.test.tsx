// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem } from '@nodus/contracts';

import { ConversationBar } from './conversation-bar.js';

/** Бар беседы: кнопки сущности (#753 — канал проекта, #754 — чат письма) —
 *  взаимоисключающие по типу беседы, без привязки кнопки нет. */

const mocks = vi.hoisted(() => ({ openCard: vi.fn() }));
vi.mock('../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => mocks.openCard,
}));

const ID = '11111111-1111-4111-8111-111111111111';

function conversation(overrides: Partial<ConversationListItem>): ConversationListItem {
  return {
    id: ID,
    type: 'group',
    title: 'Беседа',
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
    ...overrides,
  };
}

function renderBar(item: ConversationListItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConversationBar
        conversation={item}
        panelOpen={false}
        onPanelToggle={vi.fn()}
        onOpenSearch={vi.fn()}
        onOpenMembers={vi.fn()}
        onAddMembers={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.openCard.mockClear();
});

describe('ConversationBar — кнопка сущности беседы (#753, #754)', () => {
  it('канал проекта: «Открыть проект» открывает карточку проекта', () => {
    renderBar(
      conversation({
        type: 'project_channel',
        project: { id: ID, code: 'PRJ', name: 'Проект', color: 'blue' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Открыть проект' }));
    expect(mocks.openCard).toHaveBeenCalledWith({ kind: 'project', id: ID });
  });

  it('канал проекта без привязки: кнопки нет (мёртвых кнопок не бывает)', () => {
    renderBar(conversation({ type: 'project_channel', project: null }));
    expect(screen.queryByRole('button', { name: 'Открыть проект' })).toBeNull();
  });

  it('чат письма: «Открыть письмо» открывает карточку письма', () => {
    renderBar(
      conversation({
        type: 'letter',
        letter: { id: ID, regNumber: '01-15/1', subject: 'Письмо' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Открыть письмо' }));
    expect(mocks.openCard).toHaveBeenCalledWith({ kind: 'letter', id: ID });
  });

  it('чат письма без привязки: кнопки нет', () => {
    renderBar(conversation({ type: 'letter', letter: null }));
    expect(screen.queryByRole('button', { name: 'Открыть письмо' })).toBeNull();
  });

  it('чат задачи: «Открыть задачу» без регрессии — карточка задачи', () => {
    renderBar(
      conversation({
        type: 'task',
        task: { id: ID, number: 7, title: 'Задача' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Открыть задачу' }));
    expect(mocks.openCard).toHaveBeenCalledWith({ kind: 'task', id: ID });
  });

  it('direct/группа: кнопок сущности нет', () => {
    renderBar(conversation({ type: 'direct', title: 'Иван' }));
    expect(screen.queryByRole('button', { name: 'Открыть задачу' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть проект' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть письмо' })).toBeNull();
  });
});
