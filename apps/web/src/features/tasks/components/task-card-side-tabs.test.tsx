// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, TaskDetail } from '@nodus/contracts';

import { useViewerStore, type ViewerTarget } from '../../../shared/files/viewer-store.js';
import { TaskCardSideTabs } from './task-card-side-tabs.js';
import { initialTaskTabs, openTaskFileTab } from '../lib/task-tabs.js';
import { createCardTabsState } from '../../../shared/ui/entity-card/card-tabs-model.js';

vi.mock('./task-discussion.js', () => ({ TaskDiscussion: () => <div>лента</div> }));
vi.mock('./task-card-menu.js', () => ({ TaskCardMenu: () => <div>меню</div> }));
vi.mock('../../../shared/files/file-viewer-body.js', () => ({
  FileViewerBody: ({ onFullscreen }: { onFullscreen?: () => void }) => (
    <button type="button" onClick={onFullscreen}>
      фулскрин
    </button>
  ),
}));

const task = { id: 'task-1' } as unknown as TaskDetail;
const conversation = { id: 'conv-1', unreadCount: 2 } as unknown as ConversationListItem;
const file: ViewerTarget = {
  fileId: 'f1',
  name: 'a.pdf',
  mime: 'application/pdf',
  size: 10,
  url: '/files/f1',
};
const tabs = openTaskFileTab(initialTaskTabs(), file);
const state = createCardTabsState(
  [{ id: 'area-1', tabs: ['chat', 'file:f1'], active: 'file:f1' }],
  { visited: ['chat', 'file:f1'] },
);

afterEach(cleanup);
beforeEach(() => useViewerStore.getState().close());

describe('правая зона карточки задачи', () => {
  it('вкладки «Чат»/файл, закрытие, «О задаче» и фулскрин', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onToggleAbout = vi.fn();
    render(
      <TaskCardSideTabs
        task={task}
        tabs={tabs}
        conversation={conversation}
        aboutOpen={false}
        showAbout
        state={state}
        groupW={[600]}
        collapsedGroupId={null}
        onStateChange={vi.fn()}
        onGroupWidthsChange={vi.fn()}
        onActivate={onActivate}
        onClose={onClose}
        onToggleAbout={onToggleAbout}
      />,
    );
    expect(screen.getByRole('tab', { name: /Чат/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'a.pdf' }));
    expect(onActivate).toHaveBeenCalledWith('file:f1');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть вкладку: a.pdf' }));
    expect(onClose).toHaveBeenCalledWith('f1');
    fireEvent.click(screen.getByRole('button', { name: 'О задаче' }));
    expect(onToggleAbout).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'фулскрин' }));
    expect(useViewerStore.getState().target).toEqual(file);
  });
});
