import { describe, expect, it } from 'vitest';
import { FORMULA_LIMITS, type FormulaNode } from '@nodus/contracts';

import { evaluate } from './index.js';
import { lit, op, resolver, self } from './test-kit.js';

/** Бюджет вычисления (AUD-020, #866): счётчик вычисленных узлов на ОДИН
 *  вызов `evaluate`. Вложенность агрегатов не запрещена — ограничивается
 *  объём: без бюджета стоимость растёт как размер выборки в степени
 *  вложенности, и одна формула останавливает процесс api на минуты. */

const SUBTASKS = { kind: 'related', selector: { kind: 'subtasks' } } as const;
const RELATIONS = {
  kind: 'related',
  selector: { kind: 'relations', relation: 'blocks', direction: 'out' },
} as const;

function countNode(from: typeof SUBTASKS | typeof RELATIONS, filter?: FormulaNode): FormulaNode {
  return { kind: 'aggregate', from, fn: 'count', ...(filter ? { filter } : {}) };
}

/** `depth` вложенных СКОЛЬКО: каждый агрегат стоит в условии предыдущего. */
function nestedCount(depth: number): FormulaNode {
  if (depth <= 1) return countNode(SUBTASKS);
  return countNode(SUBTASKS, op('gt', nestedCount(depth - 1), lit(0)));
}

function records(count: number): { 1: number }[] {
  return Array.from({ length: count }, (_, index) => ({ 1: index + 1 }));
}

describe('evaluate: бюджет вычисления', () => {
  it('обычная формула по полной выборке в бюджет укладывается', () => {
    const ast = countNode(SUBTASKS, op('gt', self(1), lit(0)));
    const result = evaluate(ast, resolver({ selections: { subtasks: records(500) } }));
    expect(result.value).toBe(500);
    expect(result.error).toBeNull();
  });

  it('предел бюджета: в пределах — значение, за пределом — evaluation_limit', () => {
    // Вложенный агрегат — не запрещённый язык, а законная формула, но её
    // стоимость зависит от объёма внутренней выборки. Узел бюджета — 50 000
    // вычислений; 500 внешних × (3 + 3·32) + 1 = 49 501 укладывается,
    // а 500 × (3 + 3·33) + 1 = 51 001 — уже за пределом.
    const ast = countNode(
      SUBTASKS,
      op('gt', countNode(RELATIONS, op('gt', self(1), lit(0))), lit(0)),
    );
    const within = evaluate(
      ast,
      resolver({
        selections: { subtasks: records(500), 'relations:blocks:out': records(32) },
      }),
    );
    expect(within.value).toBe(500);
    expect(within.error).toBeNull();

    const beyond = evaluate(
      ast,
      resolver({
        selections: { subtasks: records(500), 'relations:blocks:out': records(33) },
      }),
    );
    expect(beyond.value).toBeNull();
    expect(beyond.error?.code).toBe('evaluation_limit');
  });

  it('4 вложенных СКОЛЬКО на выборке 500 — ошибка бюджета, работа ограничена бюджетом', () => {
    const data = resolver({ selections: { subtasks: records(500) } });
    // Детерминированная мера работы — число вычисленных агрегатов (вызовов
    // select): без бюджета оно росло бы как 500^вложенность (минуты), с
    // бюджетом не превышает лимит узлов. Wall-clock «быстрее 200 мс» на
    // CI-раннере под v8-coverage непостоянен (542 мс против 3 мс локально) —
    // миллисекундные замеры по канону живут в perf-прогоне вне блокирующего
    // CI (AGENTS.md, «Тесты»); здесь проверяется само ограничение работы.
    let aggregates = 0;
    const counted: typeof data = {
      single: (source) => data.single(source),
      select: (from) => {
        aggregates += 1;
        return data.select(from);
      },
    };
    const result = evaluate(nestedCount(4), counted);
    expect(result.error?.code).toBe('evaluation_limit');
    expect(aggregates).toBeLessThanOrEqual(FORMULA_LIMITS.evaluationNodes);
  });
});
