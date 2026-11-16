import { FORMULA_LIMITS } from '@nodus/contracts';

import { fail } from './runtime.js';

/**
 * Бюджет вычисления ячейки (AUD-020, #866): счётчик вычисленных узлов на
 * ОДИН вызов `evaluate`. Счётчик живёт на вызов, а не на процесс: тяжёлая
 * ячейка не расходует бюджет соседних. Вложенные агрегаты не запрещаются —
 * ограничивается объём, потому что условие агрегата вычисляется для каждой
 * записи выборки и стоимость растёт как 500^вложенность.
 */
export class EvaluationBudget {
  private used = 0;

  constructor(private readonly limit: number = FORMULA_LIMITS.evaluationNodes) {}

  /** Учесть вычисление узла; за пределом — ошибка ячейки с отдельным кодом. */
  consume(): void {
    this.used += 1;
    if (this.used > this.limit) {
      fail('evaluation_limit', `formula evaluation exceeds ${this.limit} nodes`);
    }
  }
}
