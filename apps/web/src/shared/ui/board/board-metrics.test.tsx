// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardColumn } from './board-column.js';
import {
  BOARD_COLUMN_CLASS,
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
 * Геометрия канбан-доски (#730, уточнение владельца 10.11.2026): плитка
 * тянется по ряду и делит его на 6 (включая «Добавить стадию»), пустого места
 * справа нет, а минимум — 1/6 бюджета ряда, выведенный из промежутка и внешних
 * отступов (не константа вроде 208px). Тест держит формулу и следит, чтобы
 * доска, «Добавить стадию» и скелетон брали геометрию из ОДНОГО места.
 */

/** Ширина ряда на Full HD при развёрнутом меню: 1550 − 2×16 внешних отступов. */
const ROW_PX = 1518;

/** `gap-2` → 0.5rem; `px-[0.8rem]` → 0.8rem (шаг spacing Tailwind — 0.25rem). */
function gapRem(className: string): number {
  return Number(className.match(/gap-([\d.]+)/)?.[1]) * 0.25;
}
function edgeRem(className: string): number {
  return Number(className.match(/\[([\d.]+)rem\]/)?.[1]);
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

describe('board-metrics: плитка тянется, минимум — 1/6 ряда (#730)', () => {
  it('у плитки нет фиксированной ширины — только рост по ряду', () => {
    expect(BOARD_COLUMN_CLASS).toContain('flex-1');
    expect(BOARD_COLUMN_CLASS).toContain('basis-0');
    // Фиксированная ширина (w-72, w-[10.4rem]…) — это пустое место справа при
    // 3–5 плитках; такой класс не должен вернуться.
    expect(BOARD_COLUMN_CLASS).not.toMatch(/(?:^|\s)w-(?:\d|\[)/);
    expect(BOARD_COLUMN_CLASS).not.toContain('w-72');
  });

  it('у плитки нет паддингов и рамки — flex-элемент с basis-0 прибавляет их к доле', () => {
    // Chromium считает flex-basis по content-box: собственные padding/border
    // плитки уходят СВЕРХ её 1/6 (замер владельца :4173: колонки 241,
    // «Добавить стадию» 263 — на 22px шире, правый отступ ряда съеден).
    // Поэтому отступы и пунктирный контур — внутренним блоком и outline.
    expect(BOARD_COLUMN_CLASS).not.toMatch(/(?:^|\s)(?:px|py|p|pt|pb|pl|pr)-/);
    expect(BOARD_COLUMN_CLASS).not.toMatch(/(?:^|\s)border(?:-|$)/);
  });

  it('минимальная ширина — 1/6 бюджета: минус 5 промежутков и внешние отступы', () => {
    const minClass = BOARD_COLUMN_CLASS.match(/min-w-\[calc\(\(100%_-_([\d.]+)rem\)_\/_(\d+)\)\]/);
    expect(minClass).not.toBeNull();
    const [, subtractedRem, divisor] = minClass!;
    // Знаменатель — то же число плиток, что держит ряд.
    expect(Number(divisor)).toBe(BOARD_COLUMNS_PER_VIEW);
    // Вычитаемое не магическое: 5 зазоров + 2 внешних отступа из классов ряда.
    const expected =
      (BOARD_COLUMNS_PER_VIEW - 1) * gapRem(BOARD_GAP_CLASS) + 2 * edgeRem(BOARD_EDGE_CLASS);
    expect(Number(subtractedRem)).toBeCloseTo(expected, 5);
  });

  it('промежуток 8–12 px, внешние отступы 16 px', () => {
    expect(BOARD_GAP_PX).toBeGreaterThanOrEqual(8);
    expect(BOARD_GAP_PX).toBeLessThanOrEqual(12);
    expect(BOARD_EDGE_PX).toBe(16);
  });

  it('шесть плиток влезают в ряд без прокрутки, седьмая — уже нет', () => {
    // Честная доля при 6 плитках и нижняя граница из класса.
    const fairShare6 =
      (ROW_PX - (BOARD_COLUMNS_PER_VIEW - 1) * BOARD_GAP_PX) / BOARD_COLUMNS_PER_VIEW;
    const floor =
      (ROW_PX - (BOARD_COLUMNS_PER_VIEW - 1) * BOARD_GAP_PX - 2 * BOARD_EDGE_PX) /
      BOARD_COLUMNS_PER_VIEW;
    expect(floor).toBeLessThanOrEqual(fairShare6);
    // С седьмой плиткой минимум больше честной доли → ряд переполняется и
    // включает edge-scroll, а плитки не сжимаются ниже 1/6.
    const fairShare7 =
      (ROW_PX - BOARD_COLUMNS_PER_VIEW * BOARD_GAP_PX) / (BOARD_COLUMNS_PER_VIEW + 1);
    expect(floor).toBeGreaterThan(fairShare7);
  });

  it('ряд по-прежнему скроллится по горизонтали (edge-scroll #366)', () => {
    expect(BOARD_ROW_CLASS).toContain('overflow-x-auto');
    expect(BOARD_ROW_CLASS).toContain(BOARD_GAP_CLASS);
    expect(BOARD_ROW_CLASS).toContain(BOARD_EDGE_CLASS);
  });
});

describe('board-metrics: доски и скелетон используют общую геометрию', () => {
  it('колонка стадии — плитка по ряду', () => {
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
    expect(section.className).toContain('flex-1');
    expect(section.className).toContain('min-w-[calc(');
    expect(section.className).not.toContain('w-72');
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
