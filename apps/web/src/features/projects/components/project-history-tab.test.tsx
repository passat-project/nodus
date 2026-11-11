// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHistoryEntry } from '@nodus/contracts';

import { ProjectHistoryTab } from './project-history-tab.js';

const { useProjectHistoryMock } = vi.hoisted(() => ({ useProjectHistoryMock: vi.fn() }));

vi.mock('../api/projects-api.js', () => ({ useProjectHistory: useProjectHistoryMock }));
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));
vi.mock('../../../shared/views/use-infinite-sentinel.js', () => ({
  useInfiniteSentinel: () => undefined,
}));

function entry(overrides: Partial<ProjectHistoryEntry>): ProjectHistoryEntry {
  return {
    id: 'e-1',
    kind: 'updated',
    actor: null,
    createdAt: '2026-11-11T10:00:00.000Z',
    fields: ['visibility'],
    status: null,
    users: [],
    name: null,
    ...overrides,
  };
}

function mockHistory(items: ProjectHistoryEntry[], hasNextPage = false) {
  useProjectHistoryMock.mockReturnValue({
    data: { pages: [{ items, nextCursor: null }] },
    isLoading: false,
    isError: false,
    hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
}

/** Секретная эпоха (#748, вариант Б): не-участник видит подпись о начале
 *  ленты с раскрытия; участие — полную ленту без подписи. */
describe('ProjectHistoryTab (#748)', () => {
  afterEach(() => {
    cleanup();
    useProjectHistoryMock.mockReset();
  });

  it('лента с раскрытия — подпись «История открыта с {дата}»', () => {
    mockHistory([entry({ fields: ['name', 'visibility'], name: 'Открытое имя' })]);

    render(<ProjectHistoryTab projectId="p-1" />);

    expect(screen.getByText(/История открыта с/).textContent).toContain('11.11.2026');
  });

  it('полная лента участия — подписи нет (внизу создание проекта)', () => {
    mockHistory([
      entry({ id: 'e-2', fields: ['name', 'visibility'], name: 'Открытое имя' }),
      entry({ id: 'e-1', kind: 'created', fields: [], name: 'Секретное имя' }),
    ]);

    render(<ProjectHistoryTab projectId="p-1" />);

    expect(screen.queryByText(/История открыта с/)).toBeNull();
  });

  it('лента не догружена — подпись ещё не показывается', () => {
    mockHistory([entry({ fields: ['visibility'] })], true);

    render(<ProjectHistoryTab projectId="p-1" />);

    expect(screen.queryByText(/История открыта с/)).toBeNull();
  });
});
