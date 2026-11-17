import type { DepartmentLink } from './department-tree.js';

/**
 * План пробега точки-импульса по новому маршруту спуска (#768, пакет
 * 16.11.2026, §5). Прошлый маршрут помнится: общий префикс уже закрашен и
 * заново не проходится, точка появляется у карточки расхождения (нижний порт —
 * конец закрашенного префикса) и бежит только новый хвост.
 *
 *  - первый показ/вход на вкладку: общего нет → пробег от верхней карточки;
 *  - спуск глубже: крашеный префикс остаётся, точка стартует на развилке;
 *  - соседняя ветка: маршруты расходятся в корне (или раньше) → от развилки;
 *  - выбран предок: новый маршрут — префикс прошлого → точка не бежит,
 *    закрашенный след остаётся;
 *  - тот же маршрут: пробега нет.
 */
export interface TracePlan {
  /** Сколько ведущих рёбер нового маршрута уже закрашено прошлым (общий префикс). */
  painted: number;
  /** Есть непокрашенный хвост — точка бежит от конца префикса. */
  animate: boolean;
}

export function planTrace(
  previous: readonly DepartmentLink[],
  next: readonly DepartmentLink[],
): TracePlan {
  let painted = 0;
  while (painted < previous.length && painted < next.length) {
    const before = previous[painted]!;
    const after = next[painted]!;
    if (before.parent !== after.parent || before.child !== after.child) break;
    painted += 1;
  }
  return { painted, animate: next.length > painted };
}
