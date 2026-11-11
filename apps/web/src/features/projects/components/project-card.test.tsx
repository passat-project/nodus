// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardHeaderActionsContext } from '../../../app/shell/card-header-actions.js';
import { useUiPrefsStore } from '../../../shared/preferences/ui-prefs-store.js';

const PROJECT = {
  id: 'p1',
  code: '2026-42',
  name: 'Проект',
  color: 'blue',
  status: 'active',
  access: { canManage: true, canTransfer: false, canJoin: false, canLeave: false },
  myMembership: { manager: true, assistant: false, participant: true },
};

vi.mock('../api/projects-api.js', () => ({
  useProjectDetail: () => ({ data: PROJECT, isLoading: false }),
}));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useProjectConversation: () => ({ data: undefined }),
}));
vi.mock('./project-action-bar.js', () => ({
  ProjectHeaderActions: ({ layout }: { layout?: ReactNode }) => <>{layout}</>,
}));
vi.mock('./project-about-panel.js', () => ({
  ProjectAboutPanel: () => <div>О проекте — содержимое</div>,
}));
vi.mock('../structure/components/structure-tab.js', () => ({
  StructureTab: () => <div>Структура — содержимое</div>,
}));
vi.mock('./project-tasks-tab.js', () => ({ ProjectTasksTab: () => null }));
vi.mock('./project-channel-tab.js', () => ({ ProjectChannelTab: () => null }));
vi.mock('./project-members-tab.js', () => ({ ProjectMembersTab: () => null }));
vi.mock('./project-history-tab.js', () => ({ ProjectHistoryTab: () => null }));

const { ProjectCard } = await import('./project-card.js');

/** Карточка проекта (#735): вся карточка — области вкладок; «О проекте» —
 *  обычная вкладка после «Задач»; кнопка раскладки — в шапке карточки. */
afterEach(() => {
  cleanup();
  useUiPrefsStore.setState({ personal: {}, company: {} });
});

describe('ProjectCard: «О проекте» вкладкой и шапка', () => {
  it('вкладки в системном порядке, «О проекте» после «Задач»', () => {
    render(
      <CardHeaderActionsContext.Provider value={document.body}>
        <ProjectCard projectId="p1" />
      </CardHeaderActionsContext.Provider>,
    );
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());
    expect(tabs).toEqual(['Структура', 'Задачи', 'О проекте', 'Канал', 'Участники', 'История']);
    // Статичной панели «О проекте» слева больше нет.
    expect(screen.queryByText('О проекте — содержимое')).toBeNull();
    expect(screen.getByText('Структура — содержимое')).not.toBeNull();
  });

  it('«О проекте» открывается вкладкой, кнопка раскладки — в шапке', () => {
    render(
      <CardHeaderActionsContext.Provider value={document.body}>
        <ProjectCard projectId="p1" />
      </CardHeaderActionsContext.Provider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /О проекте/ }));
    expect(screen.getByText('О проекте — содержимое')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Разделить область вкладок' })).not.toBeNull();
  });
});
