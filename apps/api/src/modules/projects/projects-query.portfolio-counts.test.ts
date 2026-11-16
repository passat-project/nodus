import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { ProjectsQueryService } from './projects-query.service.js';

/** Счётчики папок журнала (#559): видимый срез по портфелям и статусам —
 *  журнал листается курсором, поэтому числа считает сервер, а не клиент. */
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const MINE = '00000000-0000-4000-8000-0000000000a2';
const PORTFOLIO = '42000000-0000-4000-8000-000000000001';
const OTHER = '42000000-0000-4000-8000-000000000002';

function user(permissions: string[] = []): AuthUser {
  return { id: ACTOR, email: 'u@nodus.by', displayName: 'u', permissions };
}

describe('ProjectsQueryService.portfolioCounts (#559)', () => {
  const repo = { participantProjectIds: vi.fn(), portfolioCounts: vi.fn() };
  const service = new ProjectsQueryService(
    repo as never,
    { hasRow: vi.fn() } as never,
    { findPage: vi.fn() } as never,
    { toDetail: vi.fn(), toListItems: vi.fn() } as never,
    { findRefs: vi.fn() } as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    repo.participantProjectIds.mockResolvedValue([MINE]);
    repo.portfolioCounts.mockResolvedValue([]);
  });

  it('раскладывает группы по статусам и всегда добавляет «Без портфеля»', async () => {
    repo.portfolioCounts.mockResolvedValue([
      { portfolioId: PORTFOLIO, status: 'active', count: 4 },
      { portfolioId: PORTFOLIO, status: 'completed', count: 1 },
      { portfolioId: PORTFOLIO, status: 'archived', count: 2 },
      { portfolioId: OTHER, status: 'active', count: 3 },
      { portfolioId: null, status: 'completed', count: 1 },
    ]);

    const counts = await service.portfolioCounts(user());

    expect(counts).toEqual([
      { portfolioId: PORTFOLIO, active: 4, completed: 1, archived: 2 },
      { portfolioId: OTHER, active: 3, completed: 0, archived: 0 },
      { portfolioId: null, active: 0, completed: 1, archived: 0 },
    ]);
  });

  it('папка без видимых проектов не теряется — нули, а не отсутствие строки', async () => {
    repo.portfolioCounts.mockResolvedValue([]);
    await expect(service.portfolioCounts(user())).resolves.toEqual([
      { portfolioId: null, active: 0, completed: 0, archived: 0 },
    ]);
  });

  it('счётчик — тот же видимый срез, что у журнала (секретные не утекают)', async () => {
    await service.portfolioCounts(user());

    expect(repo.participantProjectIds).toHaveBeenCalledWith(ACTOR);
    expect(repo.portfolioCounts).toHaveBeenCalledWith({
      participantOf: null,
      roleSource: null,
      myProjectIds: [MINE],
      seeAll: false,
    });
  });

  it('project.view_secret считает секретные проекты всех портфелей', async () => {
    await service.portfolioCounts(user(['project.view_secret']));

    expect(repo.portfolioCounts).toHaveBeenCalledWith(
      expect.objectContaining({ seeAll: true, myProjectIds: [MINE] }),
    );
  });

  it('scope=mine сужает до моего участия — те же цифры, что у журнала', async () => {
    await service.portfolioCounts(user(), 'mine');

    expect(repo.portfolioCounts).toHaveBeenCalledWith(
      expect.objectContaining({ participantOf: ACTOR }),
    );
  });

  it('scope=all (по умолчанию) — весь видимый срез', async () => {
    await service.portfolioCounts(user(), 'all');

    expect(repo.portfolioCounts).toHaveBeenCalledWith(
      expect.objectContaining({ participantOf: null }),
    );
  });
});
