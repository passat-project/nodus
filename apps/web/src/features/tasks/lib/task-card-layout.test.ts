import { describe, expect, it } from 'vitest';

import {
  BRANCH_MIN_W,
  MIN_TASK_MAIN_W,
  branchMaxWidth,
  chatColumnWidth,
  clampBranchWidth,
  rowMinWidths,
  rowMinWidthsCss,
} from './task-card-layout.js';

describe('chatColumnWidth — чат буфер сужений', () => {
  it('сужения ряда едят чат', () => {
    expect(chatColumnWidth(900, 300, 500)).toBe(600);
  });
  it('ниже пола чат не опускается', () => {
    expect(chatColumnWidth(700, 360, 500)).toBe(500);
  });
  it('потолок отдаёт излишек левой зоне, но пол сильнее (карточка сотрудника #750)', () => {
    expect(chatColumnWidth(900, 0, 420, 700)).toBe(700);
    expect(chatColumnWidth(900, 0, 420, 300)).toBe(420);
  });
});

describe('branchMaxWidth — предел перегородки навигатора', () => {
  it('широкий ряд: не шире половины ряда', () => {
    expect(branchMaxWidth(3000, 500)).toBe(1500);
  });
  it('средний ряд: центру остаётся его минимум при чате на полу', () => {
    const row = 1800;
    const floor = 500;
    const max = branchMaxWidth(row, floor);
    expect(max).toBe(row - MIN_TASK_MAIN_W - floor);
    expect(row - max - floor).toBe(MIN_TASK_MAIN_W);
  });
  it('тесный ряд: предел не уже минимума навигатора', () => {
    expect(branchMaxWidth(600, 500)).toBe(BRANCH_MIN_W);
  });
});

describe('clampBranchWidth', () => {
  it('держит ширину в [минимум; предел]', () => {
    expect(clampBranchWidth(10, 800)).toBe(BRANCH_MIN_W);
    expect(clampBranchWidth(5000, 800)).toBe(800);
    expect(clampBranchWidth(BRANCH_MIN_W + 50, 800)).toBe(BRANCH_MIN_W + 50);
  });
  it('вырожденный предел меньше минимума — минимум', () => {
    expect(clampBranchWidth(500, 100)).toBe(BRANCH_MIN_W);
  });
});

describe('rowMinWidths — минимумы колонок ряда', () => {
  const floor = 350;
  const fits = (row: number, open: boolean) => {
    const m = rowMinWidths(row, floor, open);
    return m.branch + m.main + floor <= row;
  };

  it('ряд вмещает всё: навигатор и центр на своих минимумах', () => {
    expect(rowMinWidths(2000, floor, true)).toEqual({
      branch: BRANCH_MIN_W,
      main: MIN_TASK_MAIN_W,
    });
  });
  it('ряд тесен: первым ниже минимума уходит навигатор, центр держит свой', () => {
    const row = MIN_TASK_MAIN_W + floor + 100;
    expect(rowMinWidths(row, floor, true)).toEqual({ branch: 100, main: MIN_TASK_MAIN_W });
  });
  it('не помещается даже без навигатора — только тогда уступает центр', () => {
    const row = MIN_TASK_MAIN_W + floor - 50;
    expect(rowMinWidths(row, floor, true)).toEqual({ branch: 0, main: MIN_TASK_MAIN_W - 50 });
  });
  it('навигатор закрыт: центр держит минимум, пока ряд вмещает его с чатом', () => {
    expect(rowMinWidths(1500, floor, false)).toEqual({ branch: 0, main: MIN_TASK_MAIN_W });
  });
  it('сумма минимумов никогда не выдавливает чат за край ряда', () => {
    for (let row = floor; row <= 2500; row += 37) {
      expect(fits(row, true)).toBe(true);
      expect(fits(row, false)).toBe(true);
    }
  });
  it('CSS-зеркало несёт те же пороги', () => {
    const css = rowMinWidthsCss(floor, true);
    expect(css.branch).toBe(
      `clamp(0px, calc(100% - ${MIN_TASK_MAIN_W + floor}px), ${BRANCH_MIN_W}px)`,
    );
    expect(css.main).toBe(
      `clamp(0px, calc(100% - ${floor}px - ${css.branch}), ${MIN_TASK_MAIN_W}px)`,
    );
    expect(rowMinWidthsCss(floor, false).branch).toBe('0px');
  });
});
