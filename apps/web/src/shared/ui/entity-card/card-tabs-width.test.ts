import { describe, expect, it } from 'vitest';

import { CARD_TAB_WIDTH, groupRatios, solveCardWidths } from './card-tabs-width.js';

const CHAT = { id: 'a1', isChat: true, prefW: CARD_TAB_WIDTH.chatPref };
const DOC = { id: 'a2', isChat: false, prefW: CARD_TAB_WIDTH.groupPref };
const PLAIN = { id: 'a1', isChat: false, prefW: CARD_TAB_WIDTH.groupPref };

function letter(rowWidth: number, panelOpen = true) {
  return solveCardWidths({
    rowWidth,
    dataEnabled: true,
    dataPref: 340,
    panelOpen,
    panelW: 300,
    groups: [CHAT, DOC],
  });
}

describe('solveCardWidths — таблица письма/задачи (панель 300)', () => {
  it('1320: чат уступает до 280, документ 400', () => {
    const r = letter(1320);
    expect([r.dataW, r.groupW[0], r.groupW[1], r.panelW]).toEqual([340, 280, 400, 300]);
    expect(r.totalW).toBe(1320);
    expect(r.collapsedGroupId).toBeNull();
  });

  it('1200: документ на минимуме, данные 340', () => {
    const r = letter(1200);
    expect([r.dataW, r.groupW[0], r.groupW[1], r.panelW]).toEqual([340, 280, 280, 300]);
  });

  it('1180: данные уступают до 320 — все четыре видны', () => {
    const r = letter(1180);
    expect([r.dataW, r.groupW[0], r.groupW[1], r.panelW]).toEqual([320, 280, 280, 300]);
  });

  it('1000: вторая область временно свёрнута, чат забирает остаток', () => {
    const r = letter(1000);
    expect(r.collapsedGroupId).toBe('a2');
    expect(r.groupW[1]).toBe(0);
    expect([r.dataW, r.groupW[0], r.panelW]).toEqual([340, 360, 300]);
  });

  it('900: предел с панелью — данные 320, чат 280', () => {
    const r = letter(900);
    expect([r.dataW, r.groupW[0], r.panelW]).toEqual([320, 280, 300]);
    expect(r.collapsedGroupId).toBe('a2');
  });

  it('850: панель временно скрыта, данные вернулись к 340', () => {
    const r = letter(850);
    expect([r.dataW, r.groupW[0], r.panelW]).toEqual([340, 510, 0]);
    expect(r.panelRendered).toBe(false);
  });

  it('740: минимум карточки — данные 320 + чат 420, панель скрыта', () => {
    const r = letter(740);
    expect([r.dataW, r.groupW[0], r.panelW]).toEqual([320, 420, 0]);
    expect(r.totalW).toBe(740);
  });

  it('с ростом ширины всё возвращается к предпочтениям (derived не залипает)', () => {
    const narrow = letter(850);
    expect(narrow.panelRendered).toBe(false);
    const wide = letter(1320);
    expect(wide.panelRendered).toBe(true);
    expect(wide.collapsedGroupId).toBeNull();
  });
});

describe('solveCardWidths — задача с «О задаче» 360', () => {
  it('порог всех четырёх сдвинут на 60px', () => {
    const fit = solveCardWidths({
      rowWidth: 1240,
      dataEnabled: true,
      dataPref: 340,
      panelOpen: true,
      panelW: 360,
      groups: [CHAT, DOC],
    });
    // 1240 = 320 + 360 + 280 + 280: все четыре видны, данные на минимуме.
    expect([fit.dataW, fit.groupW[0], fit.groupW[1], fit.panelW]).toEqual([320, 280, 280, 360]);
    expect(fit.collapsedGroupId).toBeNull();
    const roomy = solveCardWidths({
      rowWidth: 1260,
      dataEnabled: true,
      dataPref: 340,
      panelOpen: true,
      panelW: 360,
      groups: [CHAT, DOC],
    });
    expect([roomy.dataW, roomy.groupW[0], roomy.groupW[1], roomy.panelW]).toEqual([
      340, 280, 280, 360,
    ]);
    const tight = solveCardWidths({
      rowWidth: 1180,
      dataEnabled: true,
      dataPref: 340,
      panelOpen: true,
      panelW: 360,
      groups: [CHAT, DOC],
    });
    expect(tight.collapsedGroupId).toBe('a2');
  });
});

describe('solveCardWidths — проект без панели данных', () => {
  it('одна область занимает всю ширину', () => {
    const r = solveCardWidths({ rowWidth: 1000, groups: [CHAT] });
    expect(r.dataW).toBe(0);
    expect(r.groupW).toEqual([1000]);
  });

  it('панель 300 и чат: 600 → 300/300, 500 → панель скрыта', () => {
    expect(
      solveCardWidths({ rowWidth: 600, panelOpen: true, panelW: 300, groups: [CHAT] }).groupW,
    ).toEqual([300]);
    const hidden = solveCardWidths({
      rowWidth: 500,
      panelOpen: true,
      panelW: 300,
      groups: [CHAT],
    });
    expect(hidden.panelRendered).toBe(false);
    expect(hidden.groupW).toEqual([500]);
  });

  it('чат в правой области: сворачивается левая, чат не трогаем', () => {
    const r = solveCardWidths({
      rowWidth: 500,
      groups: [PLAIN, { id: 'a2', isChat: true, prefW: 470 }],
    });
    expect(r.collapsedGroupId).toBe('a1');
    expect(r.groupW[0]).toBe(0);
    expect(r.groupW[1]).toBe(500);
  });
});

describe('solveCardWidths — инварианты', () => {
  it('сумма не превышает ширину, панель либо целая, либо скрыта', () => {
    for (let width = 740; width <= 1600; width += 20) {
      const r = letter(width);
      expect(r.totalW).toBeLessThanOrEqual(width);
      expect(r.panelW === 0 || r.panelW === 300).toBe(true);
      expect(r.dataW).toBeGreaterThanOrEqual(320);
      const live = r.groupW.filter((w) => w > 0);
      for (const w of live) expect(w).toBeGreaterThanOrEqual(280);
    }
  });

  it('чат без панели не ниже 420', () => {
    const r = solveCardWidths({ rowWidth: 500, groups: [CHAT] });
    expect(r.groupW[0]).toBeGreaterThanOrEqual(420);
  });

  it('входные предпочтения не мутируются', () => {
    const groups = [{ ...CHAT }, { ...DOC }];
    solveCardWidths({ rowWidth: 900, groups, dataEnabled: true, panelOpen: true, panelW: 300 });
    expect(groups[0]?.prefW).toBe(470);
    expect(groups[1]?.prefW).toBe(470);
  });

  it('groupRatios отдаёт доли живых областей', () => {
    expect(groupRatios(letter(1200))).toEqual([0.5, 0.5]);
  });
});
