import { describe, expect, it, vi } from 'vitest';

import { ProjectsRepository, type ProjectListFilter } from './projects.repository.js';

/** Фильтр журнала (#559): сентинел `portfolioId=none` — папка «Без
 *  портфеля», счётчики папок — тот же `where`, что и список. */
const BASE: ProjectListFilter = {
  participantOf: null,
  roleSource: null,
  myProjectIds: [],
  seeAll: true,
};

function filterOf(overrides: Partial<ProjectListFilter> = {}): ProjectListFilter {
  return { ...BASE, ...overrides };
}

function makeRepository() {
  const groupBy = vi
    .fn()
    .mockResolvedValue([{ portfolioId: null, status: 'active', _count: { _all: 2 } }]);
  const prisma = { project: { groupBy } };
  return { repository: new ProjectsRepository(prisma as never), groupBy };
}

describe('ProjectsRepository.visibleWhere: портфель-папка (#559)', () => {
  it('`none` — только проекты без портфеля', () => {
    const { repository } = makeRepository();

    expect(repository.visibleWhere(filterOf({ portfolioId: 'none' }))).toEqual({
      AND: [{ portfolioId: null }],
    });
  });

  it('uuid портфеля — только его проекты', () => {
    const { repository } = makeRepository();
    const portfolioId = '42000000-0000-4000-8000-000000000001';

    expect(repository.visibleWhere(filterOf({ portfolioId }))).toEqual({
      AND: [{ portfolioId }],
    });
  });

  it('без фильтра папки — портфель не ограничивает журнал', () => {
    const { repository } = makeRepository();

    expect(repository.visibleWhere(filterOf())).toEqual({});
  });
});

describe('ProjectsRepository.portfolioCounts (#559)', () => {
  it('один groupBy по статусам — полный счётчик, а не загруженная страница', async () => {
    const { repository, groupBy } = makeRepository();

    await expect(repository.portfolioCounts(filterOf({ portfolioId: 'none' }))).resolves.toEqual([
      { portfolioId: null, status: 'active', count: 2 },
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['portfolioId', 'status'],
      where: { AND: [{ portfolioId: null }] },
      _count: { _all: true },
    });
  });

  it('totals не считает секретные не-участника: where = видимый срез', async () => {
    const { repository, groupBy } = makeRepository();

    await repository.portfolioCounts(filterOf({ seeAll: false, myProjectIds: ['p-1'] }));

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ OR: [{ visibility: 'open' }, { id: { in: ['p-1'] } }] }],
        },
      }),
    );
  });
});
