// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardColumn } from './board-column.js';
import {
  BOARD_COLUMN_CLASS,
  BOARD_COLUMN_WIDTH_CLASS,
  BOARD_COLUMNS_PER_VIEW,
  BOARD_EDGE_CLASS,
  BOARD_EDGE_PX,
  BOARD_GAP_CLASS,
  BOARD_GAP_PX,
  BOARD_ROW_CLASS,
} from './board-metrics.js';
import { BoardScroller } from './board-scroller.js';
import { KanbanSkeleton } from './kanban-skeleton.js';

/**
 * Геометрия канбан-доски (#730, исправление #824): ширина плитки
 * ФИКСИРОВАННАЯ и выведена из бюджета ряда на опорном Full HD (1920×1080,
 * развёрнутое левое меню, `--ui-scale: 1.25`, корень 20px) — ровно 6 плиток,
 * включая «Добавить стадию», без прокрутки. Плитка НЕ тянется по ряду: на
 * широкоформатном мониторе она держит ту же ширину (влезают 7+), иначе
 * получались «шесть ужасно широких» колонок (баг приёмки #824). Тест держит
 * формулу и следит, чтобы доска, «Добавить стадию» и скелетон брали геометрию
 * из ОДНОГО места.
 */

/** Опорный экран теста — Full HD: 1920px / 20px корня = 96rem. */
const VIEWPORT_REM = 1920 / 20;
/** Обвязка шелла в rem (app-shell): рейка w-60 15rem + зазор ml-2 0.5rem +
 *  правая полоса EDGE_W_COLLAPSED 2.5rem + её зазор mr-2 0.5rem. */
const SHELL_CHROME_REM = 15 + 0.5 + 2.5 + 0.5;
/** Ряд доски внутри рамы: 96 − 18.5 = 77.5rem (1550 экранных px). */
const ROW_REM = VIEWPORT_REM - SHELL_CHROME_REM;

/** `gap-2` → 0.5rem; `px-[0.8rem]` → 0.8rem (шаг spacing Tailwind — 0.25rem). */
function gapRem(className: string): number {
  return Number(className.match(/gap-([\d.]+)/)?.[1]) * 0.25;
}
function edgeRem(className: string): number {
  return Number(className.match(/\[([\d.]+)rem\]/)?.[1]);
}
/** Ширина плитки из класса `w-[12.2rem]` в rem. */
function widthRem(className: string): number {
  return Number(className.match(/w-\[([\d.]+)rem\]/)?.[1]);
}

/** Ширина ряда, которую занимают n плиток: плитки + промежутки + отступы. */
function rowUsageRem(count: number): number {
  return (
    count * widthRem(BOARD_COLUMN_CLASS) +
    (count - 1) * gapRem(BOARD_GAP_CLASS) +
    2 * edgeRem(BOARD_EDGE_CLASS)
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('board-metrics: плитка фиксированной ширины под 6 на Full HD (#824)', () => {
  it('у плитки фиксированная ширина и запрет сжатия — роста по ряду нет', () => {
    expect(BOARD_COLUMN_WIDTH_CLASS).toContain('w-[12.2rem]');
    expect(BOARD_COLUMN_WIDTH_CLASS).toContain('shrink-0');
    // Растяжение (flex-1 basis-0) — это баг #824: на широком мониторе шесть
    // колонок занимали весь ряд и становились «ужасно широкими».
    expect(BOARD_COLUMN_CLASS).not.toContain('flex-1');
    expect(BOARD_COLUMN_CLASS).not.toContain('basis-0');
    expect(BOARD_COLUMN_CLASS).not.toContain('min-w-[calc');
  });

  it('ширина — максимальная доля 1/6 бюджета ряда, без переполнения', () => {
    const width = widthRem(BOARD_COLUMN_CLASS);
    const fairShare =
      (ROW_REM -
        2 * edgeRem(BOARD_EDGE_CLASS) -
        (BOARD_COLUMNS_PER_VIEW - 1) * gapRem(BOARD_GAP_CLASS)) /
      BOARD_COLUMNS_PER_VIEW;
    // Не шире честной доли (иначе 6 плиток не влезут), но и не уже неё более
    // чем на шаг округления 0.1rem — ширина плитки не «на глаз».
    expect(width).toBeLessThanOrEqual(fairShare + 1e-9);
    expect(width).toBeGreaterThan(fairShare - 0.05);
  });

  it('шесть плиток влезают в ряд Full HD без прокрутки, седьмая — уже нет', () => {
    expect(rowUsageRem(BOARD_COLUMNS_PER_VIEW)).toBeLessThanOrEqual(ROW_REM);
    expect(rowUsageRem(BOARD_COLUMNS_PER_VIEW + 1)).toBeGreaterThan(ROW_REM);
  });

  it('на широком мониторе (2560) плитка не растягивается — влезают 8 плиток', () => {
    // Опорный Full HD: 6 плиток занимают почти весь ряд.
    expect(rowUsageRem(BOARD_COLUMNS_PER_VIEW)).toBeGreaterThan(ROW_REM * 0.98);
    // Широкий 2560×1440: ряд 128 − 18.5 = 109.5rem; та же плитка 12.2rem —
    // шесть колонок не «раздуваются» под окно, в ряд влезают восемь.
    const wideRow = 2560 / 20 - SHELL_CHROME_REM;
    expect(widthRem(BOARD_COLUMN_CLASS)).toBeLessThan(wideRow / BOARD_COLUMNS_PER_VIEW);
    expect(rowUsageRem(8)).toBeLessThanOrEqual(wideRow);
    expect(rowUsageRem(9)).toBeGreaterThan(wideRow);
  });

  it('промежуток 8–12 px, внешние отступы 16 px', () => {
    expect(BOARD_GAP_PX).toBeGreaterThanOrEqual(8);
    expect(BOARD_GAP_PX).toBeLessThanOrEqual(12);
    expect(BOARD_EDGE_PX).toBe(16);
  });

  it('ряд по-прежнему скроллится по горизонтали (edge-scroll #366)', () => {
    expect(BOARD_ROW_CLASS).toContain('overflow-x-auto');
    expect(BOARD_ROW_CLASS).toContain(BOARD_GAP_CLASS);
    expect(BOARD_ROW_CLASS).toContain(BOARD_EDGE_CLASS);
  });
});

describe('board-metrics: доски и скелетон используют общую геометрию', () => {
  it('колонка стадии — плитка фиксированной ширины', () => {
    const { container } = render(
      <DndContext>
        <BoardColumn
          stage={{ id: 's1', name: 'В работе', color: 'info' }}
          count={0}
          cardIds={[]}
          hasNext={false}
          loadingMore={false}
          onLoadMore={() => undefined}
          emptyLabel="Нет задач"
          dropLabel="Отпустите здесь"
        >
          {null}
        </BoardColumn>
      </DndContext>,
    );
    const section = container.querySelector('section')!;
    expect(section.className).toContain(BOARD_COLUMN_WIDTH_CLASS);
    expect(section.className).not.toContain('flex-1');
  });

  it('скроллер и скелетон делят один ряд колонок (колонки не прыгают на загрузке)', () => {
    const scroller = render(
      <BoardScroller>
        <div />
      </BoardScroller>,
    );
    const row = scroller.container.querySelector<HTMLElement>('[data-board-scroller]')!;
    expect(row.className).toContain(BOARD_GAP_CLASS);
    expect(row.className).toContain(BOARD_EDGE_CLASS);
    cleanup();

    const skeleton = render(<KanbanSkeleton columns={6} />);
    const skeletonRow = skeleton.container.firstElementChild as HTMLElement;
    expect(skeletonRow.className).toContain(BOARD_GAP_CLASS);
    expect(skeletonRow.className).toContain(BOARD_EDGE_CLASS);
    const skeletonColumn = skeletonRow.firstElementChild as HTMLElement;
    expect(skeletonColumn.className).toContain(BOARD_COLUMN_CLASS);
  });
});

describe('board-metrics: режима плотности нет (#730)', () => {
  it('на доске нет переключателя «Компактно/Просторно» и его состояния', () => {
    const { container } = render(
      <BoardScroller>
        <DndContext>
          <BoardColumn
            stage={{ id: 's1', name: 'Новые', color: 'neutral' }}
            count={0}
            cardIds={[]}
            hasNext={false}
            loadingMore={false}
            onLoadMore={() => undefined}
            emptyLabel="Нет задач"
            dropLabel="Отпустите здесь"
          >
            {null}
          </BoardColumn>
        </DndContext>
      </BoardScroller>,
    );
    // Плотность — единственная, без выбора у пользователя: ни атрибута-режима,
    // ни радиогрупп/переключателей, ни подписей режимов в разметке доски.
    expect(container.querySelector('[data-density]')).toBeNull();
    expect(container.querySelectorAll('[role="radio"], [role="switch"]')).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/компакт|простор/i);
  });
});
