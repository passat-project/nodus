// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';
import type { ConversationListItem } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { takeEmployeeCardTab } from '../../../shared/chat/employee-card-nav.js';
import { registerCardBridge } from '../../../shared/lib/card-bridge.js';
import { ConversationBar } from './conversation-bar.js';

/** Бар беседы: кнопки сущности (#753 — канал проекта, #754 — чат письма) —
 *  взаимоисключающие по типу беседы, без привязки кнопки нет. */

const mocks = vi.hoisted(() => ({ openCard: vi.fn() }));
vi.mock('../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => mocks.openCard,
}));

const ID = '11111111-1111-4111-8111-111111111111';
const ME_ID = '44444444-4444-4444-8444-444444444444';
const PEER_ID = '22222222-2222-4222-8222-222222222222';

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

  it('канал С проектом: кнопки «Добавить участников» нет — состав ведёт проект (AUD-003)', () => {
    renderBar(
      conversation({
        type: 'project_channel',
        myRole: 'owner',
        project: { id: ID, code: 'PRJ', name: 'Проект', color: 'blue' },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Добавить участников' })).toBeNull();
  });

  it('канал БЕЗ проекта («Новости компании»): кнопка «Добавить участников» на месте (AUD-003)', () => {
    renderBar(conversation({ type: 'project_channel', myRole: 'owner', project: null }));
    expect(screen.getByRole('button', { name: 'Добавить участников' })).toBeTruthy();
  });

  it('группа: кнопка «Добавить участников» на месте (право addMembers)', () => {
    renderBar(conversation({ type: 'group', myRole: 'owner' }));
    expect(screen.getByRole('button', { name: 'Добавить участников' })).toBeTruthy();
  });
});

describe('ConversationBar — шапка личного чата (#972)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: ME_ID, email: 'me@nodus.by', displayName: 'Я Сам', permissions: [] },
    });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null });
  });

  it('клик по шапке открывает карточку собеседника со стартом на «Задачах»', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    renderBar(
      conversation({
        type: 'direct',
        title: 'Иван Петров',
        membersPreview: [{ id: PEER_ID, displayName: 'Иван Петров', avatarUrl: null }],
      }),
    );

    const header = screen.getByRole('button', {
      name: `Иван Петров, ${ui.chat.openEmployeeCard}`,
    });
    // Нативная кнопка с курсором, ховером и подсказкой-именем (#728).
    expect(header.getAttribute('type')).toBe('button');
    expect(header.getAttribute('title')).toBe('Иван Петров');
    expect(header.className).toContain('cursor-pointer');
    expect(header.className).toContain('hover:bg-accent/60');
    expect(header.className).toContain('focus-visible:ring-1');

    fireEvent.click(header);
    const [ref, rect] = opener.mock.calls[0]!;
    expect(ref).toEqual({ kind: 'employee', id: PEER_ID });
    // rect источника — сама шапка: FLIP раскрытия и возврат в тот же диалог.
    expect(rect).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
    expect(takeEmployeeCardTab(PEER_ID)).toBe('tasks');
    close();
  });

  it('«Заметки» (чат с собой): шапка пассивна — карточки нет', () => {
    renderBar(
      conversation({
        type: 'direct',
        title: 'Избранное',
        membersPreview: [{ id: ME_ID, displayName: 'Я Сам', avatarUrl: null }],
      }),
    );
    expect(screen.queryByRole('button', { name: new RegExp(ui.chat.openEmployeeCard) })).toBeNull();
  });

  it('группа: шапка по-прежнему без профиля, переименование работает', () => {
    renderBar(conversation({ type: 'group', myRole: 'owner', title: 'Беседа' }));
    expect(screen.queryByRole('button', { name: new RegExp(ui.chat.openEmployeeCard) })).toBeNull();
    expect(screen.getByRole('button', { name: 'Беседа' })).not.toBeNull();
  });
});

describe('ConversationBar: Esc в переименовании (#843)', () => {
  it('Esc гасит только редактор заголовка — карточка под ним не закрывается', () => {
    const onKeyDown = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <div onKeyDown={onKeyDown}>
        <QueryClientProvider client={client}>
          <ConversationBar
            conversation={conversation({ myRole: 'owner' })}
            panelOpen={false}
            onPanelToggle={vi.fn()}
            onOpenSearch={vi.fn()}
            onOpenMembers={vi.fn()}
            onAddMembers={vi.fn()}
          />
        </QueryClientProvider>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Беседа' }));
    const input = screen.getByLabelText(ui.chat.renameTitle);
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByLabelText(ui.chat.renameTitle)).toBeNull();
    // Редактор погасил Esc сам — карточка под ним НЕ получает событие.
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
