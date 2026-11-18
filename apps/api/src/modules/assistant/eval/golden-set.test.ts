import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../tools/catalog.js';
import { GOLDEN_SET } from './golden/index.js';
import {
  GOLDEN_ROLES,
  GOLDEN_SET_MAX,
  GOLDEN_SET_MIN,
  type GoldenRole,
} from './golden-set.types.js';

/**
 * Целостность золотого набора (#926): данные — фундамент eval, поэтому
 * проверяются как код: размер, роли и формы, существование инструментов,
 * отсутствие реальных персональных данных, покрытие каталога.
 */

const TOOL_IDS = new Set(ALL_TOOLS.map((tool) => tool.id));
/** Минимум на роль: базовые 30 + кейсы партий инструментов. */
const ROLE_MIN: Record<GoldenRole, number> = { gip: 30, secretary: 30, admin: 30, employee: 30 };
const REAL_DATA = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\+?\d[\d\s()-]{9,}\d/;

describe('золотой набор: состав', () => {
  it('100–150 кейсов, уникальные id, по 30 на роль', () => {
    expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(GOLDEN_SET_MIN);
    expect(GOLDEN_SET.length).toBeLessThanOrEqual(GOLDEN_SET_MAX);
    expect(new Set(GOLDEN_SET.map((item) => item.id)).size).toBe(GOLDEN_SET.length);
    for (const role of GOLDEN_ROLES) {
      expect(GOLDEN_SET.filter((item) => item.role === role).length).toBeGreaterThanOrEqual(
        ROLE_MIN[role],
      );
    }
  });

  it('формы формулировок представлены у каждой роли', () => {
    for (const role of GOLDEN_ROLES) {
      const forms = new Set(
        GOLDEN_SET.filter((item) => item.role === role).map((item) => item.form),
      );
      expect([...forms].sort()).toEqual(['colloquial', 'official', 'typo']);
    }
  });

  it('есть отказы и уточнения, у каждого поддерживаемого кейса — ожидание', () => {
    const noTool = GOLDEN_SET.filter((item) => item.noToolCase);
    const clarify = GOLDEN_SET.filter((item) => item.shouldClarify);
    expect(noTool.length).toBeGreaterThanOrEqual(15);
    expect(clarify.length).toBeGreaterThanOrEqual(4);
    for (const item of GOLDEN_SET) {
      if (item.noToolCase || item.shouldClarify) {
        expect(item.expectedTools).toEqual([]);
        expect(item.forbiddenTools.length).toBeGreaterThan(0);
      } else {
        expect(item.expectedTools.length).toBeGreaterThan(0);
      }
      expect(item.rationale.trim().length).toBeGreaterThan(10);
    }
  });

  it('ожидаемые и запрещённые инструменты существуют и не пересекаются', () => {
    const problems: string[] = [];
    for (const item of GOLDEN_SET) {
      for (const id of [...item.expectedTools, ...item.forbiddenTools]) {
        if (!TOOL_IDS.has(id)) problems.push(`${item.id}: неизвестный инструмент ${id}`);
      }
      const expected = new Set(item.expectedTools);
      for (const id of item.forbiddenTools) {
        if (expected.has(id)) problems.push(`${item.id}: ${id} одновременно ожидается и запрещён`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('в запросах нет реальных почт, телефонов и ссылок', () => {
    const problems = GOLDEN_SET.filter((item) => REAL_DATA.test(item.query)).map(
      (item) => `${item.id}: «${item.query}»`,
    );
    expect(problems).toEqual([]);
  });

  it('каталог покрыт золотым набором (кроме мета-поиска)', () => {
    const mentioned = new Set(GOLDEN_SET.flatMap((item) => item.expectedTools));
    const unmentioned = ALL_TOOLS.filter(
      (tool) => tool.module !== 'system' && !mentioned.has(tool.id),
    ).map((tool) => tool.id);
    expect(unmentioned).toEqual([]);
  });
});
