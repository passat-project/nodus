// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from '@nodus/contracts';

const fetchNextPage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../api/time-api.js', () => ({
  useTimeEntries: () => ({
    data: { pages: [{ items: [], nextCursor: 'c1' }] },
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage,
  }),
  useAddTimeEntry: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTimeEntry: () => ({ mutate: vi.fn() }),
  useRunningTimer: () => ({ data: null }),
  useStartTimer: () => ({ mutate: vi.fn() }),
  useStopTimer: () => ({ mutate: vi.fn() }),
}));

import { TaskSpentField } from './task-time.js';

/** #1032: «Затрачено» листает по курсору — кнопка «Показать ещё записи». */
const task = {
  id: 'task-1',
  number: 1,
  title: 'Задача',
  spentMinutes: 0,
  access: { canLogTime: true },
} as unknown as TaskDetail;

afterEach(cleanup);

describe('TaskSpentField: пагинация записей (#1032)', () => {
  it('кнопка видна при hasNextPage и просит следующую страницу', async () => {
    render(<TaskSpentField task={task} />);
    fireEvent.click(screen.getByRole('button', { name: 'Учёт времени' }));

    const more = await screen.findByRole('button', { name: 'Показать ещё записи' });
    fireEvent.click(more);

    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1));
  });
});
