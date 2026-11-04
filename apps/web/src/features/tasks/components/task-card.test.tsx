// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from '@nodus/contracts';

import { TaskCard } from './task-card.js';

const task = {
  id: 'task-1',
  title: 'Задача',
  chain: [],
  source: 'manual',
  stage: { name: 'В работе', systemState: 'active', color: 'neutral' },
  access: { canEdit: true },
} as unknown as TaskDetail;

vi.mock('../api/tasks-api.js', () => ({
  useTaskDetail: () => ({ data: task, isLoading: false, error: null }),
}));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useTaskConversation: () => ({ data: { id: 'conv-1', unreadCount: 1 } }),
}));
vi.mock('../../../shared/api/read-entity-notifications.js', () => ({
  useReadEntityNotifications: () => undefined,
}));
vi.mock('../../../app/shell/right-rail.js', () => ({ useRailShrink: () => 0 }));
vi.mock('../../../app/shell/use-card-stack.js', () => ({
  useReplaceTopCard: () => vi.fn(),
}));
vi.mock('../lib/use-branch-width.js', () => ({
  useBranchWidth: () => ({
    branchW: 0,
    dragging: false,
    onDividerDown: vi.fn(),
    onDividerReset: vi.fn(),
  }),
}));
vi.mock('../lib/task-card-type-layout.js', () => ({
  useTaskCardLayout: () => ({
    blockVisible: () => true,
    isRequired: () => false,
    roleLabel: (key: string) => key,
  }),
}));
vi.mock('./task-card-data-panel.js', () => ({
  TaskCardDataPanel: ({ onToggleBranch }: { onToggleBranch: () => void }) => (
    <button type="button" onClick={onToggleBranch}>
      ветка
    </button>
  ),
}));
vi.mock('./task-card-side-tabs.js', () => ({
  TaskCardSideTabs: ({ onToggleAbout }: { onToggleAbout: () => void }) => (
    <button type="button" onClick={onToggleAbout}>
      о задаче
    </button>
  ),
}));
vi.mock('./task-branch-drawer.js', () => ({ TaskBranchDrawer: () => <div>ветка</div> }));
vi.mock('./task-about-drawer.js', () => ({ TaskAboutDrawer: () => <div>о задаче</div> }));
vi.mock('./task-card-skeleton.js', () => ({ TaskCardSkeleton: () => <div>скелетон</div> }));

afterEach(cleanup);

describe('карточка задачи', () => {
  it('рендерит данные/вкладки и переключает ветку и «О задаче»', () => {
    render(<TaskCard taskId="task-1" />);
    expect(screen.getByRole('button', { name: 'ветка' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ветка' }));
    expect(screen.getByRole('button', { name: 'о задаче' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'о задаче' }));
  });
});
