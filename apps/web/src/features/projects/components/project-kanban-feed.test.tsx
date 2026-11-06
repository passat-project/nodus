// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectKanban } from './project-kanban.js';

/**
 * #330: колонка проектного канбана перезапрашивается на загруженную глубину —
 * `feedUrl` обязан прокинуть `limit` из движка доски в URL фида (иначе
 * перезапрос после WS-события снова возьмёт первую страницу и хвост потеряется).
 */

type FeedUrl = (stageId: string, cursor: string | null, limit: number) => string;

const { feedUrlMock, state } = vi.hoisted(() => ({
  feedUrlMock: vi.fn(
    (projectId: string, stageId: string, cursor: string | null, limit: number) =>
      `/feed?project=${projectId}&stage=${stageId}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
  ),
  state: { captured: null as null | { feedUrl: FeedUrl } },
}));

vi.mock('../../../shared/ui/board/use-kanban-board.js', () => ({
  useKanbanBoard: (props: { feedUrl: FeedUrl }) => {
    state.captured = props;
    return { ready: false, items: [] };
  },
}));
vi.mock('../api/projects-api.js', () => ({
  useMoveProjectTask: () => ({ mutate: vi.fn() }),
  projectKanbanFeedUrl: feedUrlMock,
}));
vi.mock('../../../shared/api/task-stages.js', () => ({ useTaskStages: () => ({ data: [] }) }));
vi.mock('../../../shared/api/process-types-api.js', () => ({
  defaultTaskType: () => undefined,
  useAliveProcessTypes: () => ({ data: [] }),
}));
vi.mock('../../../shared/tasks/quick-create.js', () => ({ useQuickCreate: () => ({}) }));
// Реестр вида грузит определения атрибутов (#632) — тесту фида не нужен.
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));
vi.mock('../../../shared/views/use-view-fields.js', () => ({
  useViewFields: () => ({ isVisible: () => true }),
}));
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));

describe('ProjectKanban: feedUrl прокидывает глубину колонки (#330)', () => {
  it('limit из движка доски доходит до URL фида', () => {
    render(<ProjectKanban projectId="p1" />);
    expect(state.captured).not.toBeNull();

    expect(state.captured?.feedUrl('s1', null, 42)).toBe('/feed?project=p1&stage=s1&limit=42');
    expect(feedUrlMock).toHaveBeenCalledWith('p1', 's1', null, 42);

    expect(state.captured?.feedUrl('s1', 'c1', 100)).toBe(
      '/feed?project=p1&stage=s1&limit=100&cursor=c1',
    );
  });
});
