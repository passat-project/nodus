// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardColumn } from './board-column.js';
import {
  BOARD_COLUMN_CLASS,
  BOARD_COLUMN_GROW_CLASS,
  BOARD_COLUMN_MAX_CLASS,
  BOARD_COLUMN_MIN_CLASS,
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
 * Геометрия канбан-доски (#730, исправление #824): ширина плитки — ПОЛОСА
 * 240–360px, динамическая, как в Битриксе (замер владельца 12.11.2026: колонка
 * 259px в окне 2248 и 369px в развёрнутом на 3439). Плитка делит ряд поровну,
 * пока доля внутри полосы: на Full HD 6 плиток заполняют ряд (≈244px), на
 * 2560 шесть плиток тянутся до ≈351px, восемь делят ряд (≈261px); на ultrawide
 * 3440 шесть упираются в потолок 360 (не «ужасно широкие»); ниже пола
 * включается горизонтальная прокрутка. Тест держит формулу и следит, чтобы
 * доска, «Добавить стадию» и скелетон брали геометрию из ОДНОГО места.
 */

/** Обвязка шелла в rem (app-shell): рейка w-60 15rem + зазор ml-2 0.5rem +
 *  правая полоса EDGE_W_COLLAPSED 2.5rem + её зазор mr-2 0.5rem. */
const SHELL_CHROME_REM = 15 + 0.5 + 2.5 + 0.5;

/** `gap-2` → 0.5rem; `px-[0.8rem]` → 0.8rem (шаг spacing Tailwind — 0.25rem). */
function gapRem(className: string): number {
  return Number(className.match(/gap-([\d.]+)/)?.[1]) * 0.25;
}
function edgeRem(className: string): number {
  return Number(className.match(/\[([\d.]+)rem\]/)?.[1]);
}
/** Значение из `min-w-[12rem]` / `max-w-[15rem]` в rem. */
function boundRem(className: string, kind: 'min-w' | 'max-w'): number {
  return Number(className.match(new RegExp(`${kind}-\\[([\\d.]+)rem\\]`))?.[1]);
}

/** Ряд доски на экране заданной ширины (вместе с внешними отступами), rem. */
function rowRem(viewportPx: number): number {
  return viewportPx / 20 - SHELL_CHROME_REM;
}

/** Контент ряда (без внешних отступов) на экране заданной ширины, rem. */
function contentRem(viewportPx: number): number {
  return rowRem(viewportPx) - 2 * edgeRem(BOARD_EDGE_CLASS);
}

/** Честная доля плитки при n плитках (до ограничения полосой), rem. */
function fairShareRem(count: number, content: number): number {
  return (content - (count - 1) * gapRem(BOARD_GAP_CLASS)) / count;
}

/** Ширина плитки с учётом пола и потолка, rem. */
function widthRem(count: number, content: number): number {
  const min = boundRem(BOARD_COLUMN_CLASS, 'min-w');
  const max = boundRem(BOARD_COLUMN_CLASS, 'max-w');
  return Math.min(Math.max(fairShareRem(count, content), min), max);
}

/** Ширина ряда, которую занимают n плиток: плитки + промежутки + отступы. */
function rowUsageRem(count: number, content: number): number {
  return (
    count * widthRem(count, content) +
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

describe('board-metrics: полоса ширины 240–360px (#824)', () => {
  it('плитка тянется по ряду, но в полосе min/max — не резина без потолка', () => {
    expect(BOARD_COLUMN_GROW_CLASS).toContain('flex-1');
    expect(BOARD_COLUMN_GROW_CLASS).toContain('basis-0');
    expect(BOARD_COLUMN_MIN_CLASS).toBe('min-w-[12rem]');
    expect(BOARD_COLUMN_MAX_CLASS).toBe('max-w-[18rem]');
    // Полоса в экранных px при корне 20px: 240–360 — битриксовый диапазон
    // (min 259 / max 369 по замерам владельца 12.11.2026).
    expect(boundRem(BOARD_COLUMN_CLASS, 'min-w') * 20).toBe(240);
    expect(boundRem(BOARD_COLUMN_CLASS, 'max-w') * 20).toBe(360);
    // Жёсткой ширины (w-[…], shrink-0 + фикс) больше нет: это был баг #824 —
    // на 2560 колонки застывали узкими, когда места хватало на 8.
    expect(BOARD_COLUMN_CLASS).not.toMatch(/(?:^|\s)w-\[/);
    expect(BOARD_COLUMN_CLASS).not.toContain('shrink-0');
  });

  it('Full HD: 6 плиток делят ряд поровну (≈244px) и заполняют его, 7-я — прокрутка', () => {
    const content = contentRem(1920);
    expect(fairShareRem(BOARD_COLUMNS_PER_VIEW, content)).toBeGreaterThan(
      boundRem(BOARD_COLUMN_CLASS, 'min-w'),
    );
    expect(fairShareRem(BOARD_COLUMNS_PER_VIEW, content)).toBeLessThan(
      boundRem(BOARD_COLUMN_CLASS, 'max-w'),
    );
    // Ряд заполнен в ноль: 6 плиток + промежутки + отступы = весь ряд.
    expect(rowUsageRem(BOARD_COLUMNS_PER_VIEW, content)).toBeCloseTo(rowRem(1920), 5);
    // Седьмая плитка ниже пола → ряд переполняется, включается edge-scroll.
    expect(rowUsageRem(BOARD_COLUMNS_PER_VIEW + 1, content)).toBeGreaterThan(rowRem(1920));
  });

  it('2560: 8 плиток делят ряд (~261px), 9-я — прокрутка', () => {
    const content = contentRem(2560);
    const share8 = fairShareRem(8, content);
    expect(share8).toBeGreaterThan(boundRem(BOARD_COLUMN_CLASS, 'min-w'));
    expect(share8).toBeLessThan(boundRem(BOARD_COLUMN_CLASS, 'max-w'));
    expect(rowUsageRem(8, content)).toBeCloseTo(rowRem(2560), 5);
    expect(rowUsageRem(9, content)).toBeGreaterThan(rowRem(2560));
  });

  it('2560 с шестью плитками: тянутся (≈351px) и заполняют ряд — ширина динамическая', () => {
    const content = contentRem(2560);
    // Битрикс на широком окне тянет колонки (min 259 → max 369): у нас доля
    // 6 плиток ≈351px внутри полосы, поэтому ряд заполняется, а не застывает.
    expect(fairShareRem(6, content)).toBeGreaterThan(boundRem(BOARD_COLUMN_CLASS, 'min-w'));
    expect(fairShareRem(6, content)).toBeLessThan(boundRem(BOARD_COLUMN_CLASS, 'max-w'));
    expect(rowUsageRem(6, content)).toBeCloseTo(rowRem(2560), 5);
  });

  it('3440: шесть плиток упираются в потолок 360 — не «ужасно широкие»', () => {
    const content = contentRem(3440);
    // Честная доля 6 плиток на ultrawide — ~500px (прежний баг); потолок
    // держит ширину на битриксовом max, ряд не раздут.
    expect(fairShareRem(6, content)).toBeGreaterThan(boundRem(BOARD_COLUMN_CLASS, 'max-w'));
    expect(widthRem(6, content)).toBe(boundRem(BOARD_COLUMN_CLASS, 'max-w'));
    expect(rowUsageRem(6, content)).toBeLessThan(rowRem(3440));
    // Восемь плиток на 3440 — тоже потолок, но ряд почти полон; двенадцать
    // влезают и делят ряд, тринадцатая — прокрутка.
    expect(rowUsageRem(8, content)).toBeGreaterThan(rowRem(3440) * 0.95);
    expect(rowUsageRem(12, content)).toBeCloseTo(rowRem(3440), 5);
    expect(rowUsageRem(13, content)).toBeGreaterThan(rowRem(3440));
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
  it('колонка стадии — плитка полосы ширины', () => {
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
    expect(section.className).toContain(BOARD_COLUMN_GROW_CLASS);
    expect(section.className).toContain(BOARD_COLUMN_MIN_CLASS);
    expect(section.className).toContain(BOARD_COLUMN_MAX_CLASS);
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
