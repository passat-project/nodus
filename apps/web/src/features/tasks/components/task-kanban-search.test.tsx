// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { TaskKanban } from './task-kanban.js';

/**
 * #956: колонки «Моего плана» курсорные — поиск обязан сужать фид на сервере
 * (`search` в URL и отдельная ветка ключа), а не фильтровать загруженные
 * карточки. DnD при активном поиске выключен — урезанный набор дал бы ложные
 * индексы переноса.
 */

type BoardProps = {
  queryKey: readonly unknown[];
  feedUrl: (stageId: string, cursor: string | null, limit: number) => string;
};

const { state } = vi.hoisted(() => ({
  state: { captured: null as BoardProps | null },
}));

vi.mock('../../../shared/ui/board/use-kanban-board.js', () => ({
  useKanbanBoard: (props: BoardProps) => {
    state.captured = props;
    return { ready: false, items: [], stageList: [] };
  },
}));
vi.mock('../api/personal-stages-api.js', () => ({
  usePersonalStages: () => ({ data: [] }),
  useUpdatePersonalStage: () => ({ mutate: vi.fn() }),
  useCreatePersonalStage: () => ({ mutate: vi.fn() }),
  useDeletePersonalStage: () => ({ mutate: vi.fn() }),
  useUpdateTaskPersonalStage: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../shared/tasks/quick-create.js', () => ({ useQuickCreate: () => ({}) }));
vi.mock('../../../shared/views/task-card-fields.js', () => ({ useTaskCardFields: () => [] }));
vi.mock('../../../shared/views/use-view-fields.js', () => ({
  useViewFields: () => ({ isVisible: () => true, fields: [] }),
}));
vi.mock('../../../shared/views/use-list-toolbar.js', () => ({
  useFilteredList: (rows: unknown[]) => rows,
}));

describe('TaskKanban — серверный поиск (#956)', () => {
  it('search уходит в фид колонки и в ветку ключа доски', () => {
    render(<TaskKanban search="Смета" />);
    expect(state.captured).not.toBeNull();

    expect(state.captured?.queryKey).toEqual(tasksKeys.kanban('personal', 'Смета'));
    expect(state.captured?.feedUrl('s-1', null, 50)).toBe(
      '/tasks?personalStageId=s-1&limit=50&search=%D0%A1%D0%BC%D0%B5%D1%82%D0%B0',
    );
  });

  it('без поиска — канонический ключ и URL без search', () => {
    render(<TaskKanban />);

    expect(state.captured?.queryKey).toEqual(tasksKeys.kanban('personal'));
    expect(state.captured?.feedUrl('s-1', 'c-1', 50)).toBe(
      '/tasks?personalStageId=s-1&limit=50&cursor=c-1',
    );
  });
});
