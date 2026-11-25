import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../../shared/api-client.js';
import { personalStagesOptions } from '../../../shared/api/task-create.js';
import { taskStagesOptions } from '../../../shared/api/task-stages.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { kanbanColumnKey } from '../../../shared/lib/board/kanban-column-key.js';
import { KANBAN_FEED_LIMIT } from '../../../shared/ui/board/kanban-feed-limit.js';
import {
  personalBoardFeedUrl,
  personalBoardKey,
  prefetchPersonalBoard,
} from './tasks-board-prefetch.js';

vi.mock('../../../shared/api-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/api-client.js')>()),
  api: vi.fn(),
}));

/**
 * Данные доски — в кэш до клика (#1051): под ТЕМИ ЖЕ ключами, что читает доска,
 * и той же глубины страницы — иначе догрузка колонки перескочила бы задачи.
 */

const mockedApi = vi.mocked(api);
const stages = [{ id: 's1' }, { id: 's2' }];
const columnKey = (stageId: string) => kanbanColumnKey(personalBoardKey(), stageId);
const urls = () => mockedApi.mock.calls.map(([url]) => String(url));

describe('предзагрузка канбана «Мой план» (#1051)', () => {
  afterEach(() => vi.clearAllMocks());

  it('справочники и первая страница каждой колонки — под ключами доски, той же глубины', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (url === '/tasks/stages') return [];
      if (url === '/tasks/personal-stages') return stages;
      return { items: [{ id: url }], nextCursor: null };
    });
    const client = new QueryClient();

    await prefetchPersonalBoard(client);

    expect(client.getQueryData(personalStagesOptions.queryKey)).toEqual(stages);
    expect(client.getQueryData(taskStagesOptions().queryKey)).toEqual([]);
    expect(client.getQueryData<{ items: { id: string }[] }>(columnKey('s1'))?.items[0]?.id).toBe(
      personalBoardFeedUrl('s1', null, KANBAN_FEED_LIMIT),
    );
    expect(client.getQueryData(columnKey('s2'))).toBeDefined();
    // Колонки грузятся одна за другой от ответа справочника: колонки — только после.
    expect(urls()).toEqual([
      '/tasks/stages',
      '/tasks/personal-stages',
      '/tasks?personalStageId=s1&limit=30',
      '/tasks?personalStageId=s2&limit=30',
    ]);
  });

  it('свежие данные не перезапрашиваются: повторное наведение ничего не стоит', async () => {
    mockedApi.mockImplementation(async (url: string) =>
      url === '/tasks/personal-stages' ? stages : { items: [], nextCursor: null },
    );
    const client = new QueryClient();
    await prefetchPersonalBoard(client);
    const first = urls().length;

    await prefetchPersonalBoard(client);

    expect(urls().length).toBe(first);
  });

  it('отказ справочника — без запросов колонок и без исключения', async () => {
    mockedApi.mockRejectedValue(new Error('500'));
    const client = new QueryClient();

    await expect(prefetchPersonalBoard(client)).resolves.toBeUndefined();
    expect(urls().some((url) => url.includes('personalStageId'))).toBe(false);
  });

  it('ключ и адрес фида — те же, что собирает доска', () => {
    expect(personalBoardKey('')).toEqual(tasksKeys.kanban('personal'));
    expect(personalBoardKey(' отчёт ')).toEqual(tasksKeys.kanban('personal', 'отчёт'));
    expect(personalBoardFeedUrl('s1', null, 30)).toBe('/tasks?personalStageId=s1&limit=30');
    expect(personalBoardFeedUrl('s1', 'c2', 30, 'отчёт')).toBe(
      '/tasks?personalStageId=s1&limit=30&search=%D0%BE%D1%82%D1%87%D1%91%D1%82&cursor=c2',
    );
  });
});
