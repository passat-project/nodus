// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStructureModel } from './use-structure-model.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Фейковый `useProjectTaskPages` (AUD-014, #866): три страницы по 100/100/50
 * задач. Хук stateful — догрузка видна модели так же, как у настоящего
 * бесконечного запроса. `blockFetch` замораживает догрузку для проверки
 * индикатора.
 */
const fake = vi.hoisted(() => {
  const page = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, index) => ({
      id: `task-${from + index}`,
      nodeId: null,
      parentId: null,
      title: `Задача ${from + index}`,
      number: from + index + 1,
    }));
  return { pages: [page(0, 100), page(100, 200), page(200, 250)], blockFetch: false };
});

vi.mock('../../api/projects-api.js', async () => {
  const { useState } = await import('react');
  return {
    useProjectTaskPages: () => {
      const [count, setCount] = useState(1);
      return {
        data: { pages: fake.pages.slice(0, count).map((items) => ({ items, nextCursor: null })) },
        isLoading: false,
        isFetchingNextPage: false,
        isError: false,
        hasNextPage: count < fake.pages.length,
        fetchNextPage: () => {
          if (fake.blockFetch) return;
          setCount((current) => Math.min(current + 1, fake.pages.length));
        },
      };
    },
  };
});

vi.mock('../api/structure-api.js', () => ({
  useProjectStructure: () => ({
    data: { nodes: [], kinds: [], customFieldRefs: [] },
    isLoading: false,
  }),
}));

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));

function renderModel() {
  return renderHook(() => useStructureModel(PROJECT_ID));
}

describe('useStructureModel: полный набор задач проекта (AUD-014)', () => {
  it('три страницы → в модели все 250 задач, «Без папки» считает по полному набору', async () => {
    fake.blockFetch = false;
    const { result } = renderModel();
    await waitFor(() => expect(result.current.tasks).toHaveLength(250));

    const taskIds = new Set(result.current.tasks.map((task) => task.id));
    expect(taskIds.size).toBe(250);
    expect(result.current.isLoading).toBe(false);
    // Агрегаты строятся по полному набору: секция «Без папки» видит все 250.
    expect(result.current.noNodeRow).toMatchObject({ kind: 'noNode', count: 250 });
  });

  it('пока есть недогруженные страницы — включён индикатор загрузки', () => {
    fake.blockFetch = true;
    const { result } = renderModel();
    expect(result.current.tasks).toHaveLength(100);
    expect(result.current.isLoading).toBe(true);
    fake.blockFetch = false;
  });
});
