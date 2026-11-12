// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserCard, UserListItem } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { EmployeeCard } from './employee-card.js';

/** Карточка сотрудника (#750): профиль — постоянная левая зона, справа
 *  вкладки «Чат/Задачи/Проекты»; панель беседы живёт только на чате и не
 *  сбрасывает своё состояние; смена сотрудника в той же карточке стека
 *  возвращает вкладки к дефолту. Профиль и журналы заменены заглушками —
 *  их механика покрыта своими тестами. */

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({ loading: false }));

const CARD = {
  id: OTHER,
  displayName: 'Иван Петров',
  avatarUrl: null,
  managerId: null,
} as unknown as UserCard;
const OTHER_CARD = { ...CARD, id: THIRD, displayName: 'Пётр Сидоров' } as unknown as UserCard;

function user(id: string, displayName: string): UserListItem {
  return { id, displayName, managerId: null, positionName: null } as unknown as UserListItem;
}

const USERS = [user(ME, 'Я Сам'), user(OTHER, 'Иван Петров'), user(THIRD, 'Пётр Сидоров')];

vi.mock('../api/directory-api.js', () => ({
  useUserCard: (id: string) => ({
    data: (state.loading
      ? undefined
      : id === THIRD
        ? OTHER_CARD
        : id === ME
          ? { ...CARD, id: ME, displayName: 'Я Сам' }
          : CARD) as UserCard | undefined,
    isLoading: state.loading,
  }),
  useUsersList: () => ({ data: { items: USERS } }),
  useEmployeePresence: () => 'online',
}));
vi.mock('../../../app/shell/right-rail.js', () => ({ useRailShrink: () => 0 }));
vi.mock('../lib/use-can-manage-directory.js', () => ({ useCanManageDirectory: () => false }));
vi.mock('../../../shared/api/user-relations.js', () => ({
  useAssigneeTasks: () => ({ data: { items: [] }, isLoading: false }),
  useMemberProjects: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useDirectConversation: () => ({ data: { id: 'conv-1' } }),
}));
vi.mock('../../../shared/chat/conversation-pane.js', () => ({
  ConversationPane: () => <div>лента диалога</div>,
}));
vi.mock('./employee-profile-tab.js', () => ({
  EmployeeProfileTab: () => <div>поля профиля</div>,
}));
vi.mock('./employee-journal-tabs.js', () => ({
  EmployeeTasksTab: () => <div>журнал задач</div>,
  EmployeeProjectsTab: () => <div>журнал проектов</div>,
}));
vi.mock('../../../shared/chat/chat-side-panel.js', async () => {
  const { useState } = await import('react');
  return {
    CHAT_PANEL_W: 300,
    MIN_FEED_WITH_PANEL: 360,
    useChatSidePanel: () => {
      const [open, setOpen] = useState(false);
      return { open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) };
    },
    ChatSidePanel: ({ open }: { open: boolean }) => (
      <div data-testid="chat-side-panel" data-open={String(open)} />
    ),
    ChatPanelToggle: ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
      <button type="button" aria-label="Панель беседы" data-open={String(open)} onClick={onToggle}>
        панель
      </button>
    ),
  };
});

beforeEach(() => {
  state.loading = false;
  useAuthStore.setState({
    user: { id: ME, email: 'me@nodus.by', displayName: 'Я Сам', permissions: [] },
  });
  (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('EmployeeCard — анатомия #750', () => {
  it('профиль — постоянная левая зона, справа чат по умолчанию', () => {
    render(<EmployeeCard userId={OTHER} />);
    expect(screen.getByRole('region', { name: 'Профиль' })).not.toBeNull();
    expect(screen.getByText('поля профиля')).not.toBeNull();
    expect(screen.getByRole('tab', { name: /^Чат/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('лента диалога')).not.toBeNull();
    expect(screen.queryByText('журнал задач')).toBeNull();
  });

  it('скелетон пока данные не пришли (grid новой анатомии)', () => {
    state.loading = true;
    render(<EmployeeCard userId={OTHER} />);
    expect(screen.queryByRole('region', { name: 'Профиль' })).toBeNull();
  });

  it('журнал монтируется по клику, чат живёт скрытым', () => {
    render(<EmployeeCard userId={OTHER} />);
    fireEvent.click(screen.getByRole('tab', { name: /^Задачи/ }));
    expect(screen.getByText('журнал задач')).not.toBeNull();
    const chatPanel = screen.getByText('лента диалога').closest('[role="tabpanel"]');
    expect(chatPanel?.className).toContain('invisible');
    expect(chatPanel?.hasAttribute('inert')).toBe(true);
  });

  it('панель беседы: только на чате, состояние не сбрасывается при уходе на журнал', () => {
    render(<EmployeeCard userId={OTHER} />);
    const toggle = screen.getByRole('button', { name: 'Панель беседы' });
    fireEvent.click(toggle);
    expect(screen.getByTestId('chat-side-panel').getAttribute('data-open')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: /^Задачи/ }));
    expect(screen.queryByRole('button', { name: 'Панель беседы' })).toBeNull();
    expect(screen.getByTestId('chat-side-panel').getAttribute('data-open')).toBe('false');

    fireEvent.click(screen.getByRole('tab', { name: /^Чат/ }));
    expect(screen.getByRole('button', { name: 'Панель беседы' }).getAttribute('data-open')).toBe(
      'true',
    );
    expect(screen.getByTestId('chat-side-panel').getAttribute('data-open')).toBe('true');
  });

  it('своя карточка — первый раздел «Избранное»', () => {
    render(<EmployeeCard userId={ME} />);
    expect(screen.getByRole('tab', { name: 'Избранное' })).not.toBeNull();
    expect(screen.queryByRole('tab', { name: /^Чат/ })).toBeNull();
  });

  it('смена сотрудника в той же карточке возвращает вкладки к чату', () => {
    const { rerender } = render(<EmployeeCard userId={OTHER} />);
    fireEvent.click(screen.getByRole('tab', { name: /^Проекты/ }));
    expect(screen.getByRole('tab', { name: /^Проекты/ }).getAttribute('aria-selected')).toBe(
      'true',
    );

    rerender(<EmployeeCard userId={THIRD} />);
    expect(screen.getByRole('tab', { name: /^Чат/ }).getAttribute('aria-selected')).toBe('true');
  });
});
