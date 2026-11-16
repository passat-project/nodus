import { describe, expect, it } from 'vitest';
import type { ProjectGroup, ProjectPortfolioCount } from '@nodus/contracts';

import {
  NO_PORTFOLIO_FILTER,
  buildPortfolioFolders,
  folderLabel,
  folderStatusRows,
  inPortfolioFolder,
  portfolioFilterOf,
  totalOf,
} from './portfolio-folders.js';

/** Папки-портфели журнала «Проекты» (#559): счётчики, «Без портфеля»,
 *  подпись кнопки и попадание строки в выбранную папку. Архива нет
 *  (13.11.2026) — все папки в одном списке. */
const METRO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
};
const IT: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000002',
  name: 'ИТ-проекты',
};
const OLD: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000003',
  name: 'Старый объект',
};

function counts(
  portfolioId: string | null,
  active: number,
  completed = 0,
  archived = 0,
): ProjectPortfolioCount {
  return { portfolioId, active, completed, archived };
}

describe('buildPortfolioFolders (#559)', () => {
  it('все портфели — одним списком, в серверном порядке', () => {
    const tree = buildPortfolioFolders(
      [METRO, IT, OLD],
      [
        counts(METRO.id, 98, 2, 0),
        counts(IT.id, 5),
        counts(OLD.id, 0, 3, 0),
        counts(null, 4, 1, 2),
      ],
    );

    expect(tree.folders.map((folder) => folder.name)).toEqual([
      'Нежин-Недра',
      'ИТ-проекты',
      'Старый объект',
    ]);
    expect(tree.folders.map((folder) => folder.portfolioId)).toEqual([METRO.id, IT.id, OLD.id]);
  });

  it('«Все проекты» — сумма по всем папкам, включая «Без портфеля»', () => {
    const tree = buildPortfolioFolders(
      [METRO, IT],
      [counts(METRO.id, 98, 2, 0), counts(IT.id, 5), counts(null, 4, 1, 2)],
    );

    expect(totalOf(tree.all.counters)).toBe(112);
    expect(tree.all.counters).toEqual({ active: 107, completed: 3, archived: 2 });
  });

  it('«Без портфеля» есть всегда — нули, если строк нет', () => {
    const tree = buildPortfolioFolders([METRO], [counts(METRO.id, 2)]);
    expect(tree.unassigned.id).toBe(NO_PORTFOLIO_FILTER);
    expect(tree.unassigned.counters).toEqual({ active: 0, completed: 0, archived: 0 });
  });

  it('портфель без счётчика — строка с нулями, а не пропавшая папка', () => {
    const tree = buildPortfolioFolders([METRO], []);
    expect(tree.folders[0]?.counters).toEqual({ active: 0, completed: 0, archived: 0 });
  });
});

describe('выбор папки и строки статусов', () => {
  const tree = buildPortfolioFolders([METRO], [counts(METRO.id, 3, 1, 2), counts(null, 1)]);

  it('значение фильтра: «Все проекты» — без параметра, папка — её id', () => {
    expect(portfolioFilterOf('all')).toBeUndefined();
    expect(portfolioFilterOf(METRO.id)).toBe(METRO.id);
    expect(portfolioFilterOf(NO_PORTFOLIO_FILTER)).toBe('none');
  });

  it('внутри папки — «действует / завершён / в архиве» со счётчиками', () => {
    expect(folderStatusRows(tree.folders[0] ?? null)).toEqual([
      { status: 'active', count: 3 },
      { status: 'completed', count: 1 },
      { status: 'archived', count: 2 },
    ]);
    expect(folderStatusRows(null)).toEqual([]);
  });
});

describe('folderLabel — подпись кнопки «Портфели» (#559)', () => {
  const tree = buildPortfolioFolders([METRO], []);

  it('портфель называется своим именем, «Все» и «Без портфеля» — из словаря', () => {
    const labels = { all: 'Все проекты', none: 'Без портфеля' };

    expect(folderLabel(tree, METRO.id, labels)).toBe('Нежин-Недра');
    expect(folderLabel(tree, 'all', labels)).toBe('Все проекты');
    expect(folderLabel(tree, NO_PORTFOLIO_FILTER, labels)).toBe('Без портфеля');
  });

  it('удалённая в другой сессии папка не показывает uuid', () => {
    expect(folderLabel(tree, 'нет-такой', { all: 'Все проекты', none: 'Без портфеля' })).toBe(
      'Все проекты',
    );
  });
});

describe('inPortfolioFolder — тот же срез, что у серверного фильтра', () => {
  it('`none` — только проекты без портфеля, uuid — только своя папка', () => {
    const withPortfolio = { portfolio: { id: METRO.id, name: 'Нежин-Недра' } };
    const withoutPortfolio = { portfolio: null };

    expect(inPortfolioFolder(withPortfolio, METRO.id)).toBe(true);
    expect(inPortfolioFolder(withoutPortfolio, METRO.id)).toBe(false);
    expect(inPortfolioFolder(withoutPortfolio, NO_PORTFOLIO_FILTER)).toBe(true);
    expect(inPortfolioFolder(withPortfolio, NO_PORTFOLIO_FILTER)).toBe(false);
    expect(inPortfolioFolder(withPortfolio, undefined)).toBe(true);
  });
});
