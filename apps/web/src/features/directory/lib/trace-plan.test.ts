import { describe, expect, it } from 'vitest';

import type { DepartmentLink } from './department-tree.js';
import { planTrace } from './trace-plan.js';

/** План пробега импульса (#768, §5): общий префикс закрашен, точка бежит
 *  только новый хвост; выбран предок — точки нет. */

const link = (parent: string, child: string): DepartmentLink => ({ parent, child });

describe('planTrace (#768)', () => {
  it('первый показ — от верхней карточки', () => {
    expect(planTrace([], [link('main', 'bim'), link('bim', 'lab')])).toEqual({
      painted: 0,
      animate: true,
    });
  });

  it('спуск глубже — общий префикс не перепроходится', () => {
    expect(planTrace([link('main', 'bim')], [link('main', 'bim'), link('bim', 'lab')])).toEqual({
      painted: 1,
      animate: true,
    });
  });

  it('соседняя ветка — старт от карточки расхождения', () => {
    expect(planTrace([link('main', 'bim')], [link('main', 'build')])).toEqual({
      painted: 0,
      animate: true,
    });
    expect(
      planTrace(
        [link('main', 'bim'), link('bim', 'lab')],
        [link('main', 'bim'), link('bim', 'design')],
      ),
    ).toEqual({ painted: 1, animate: true });
  });

  it('выбран предок — маршрут стал короче, точки нет', () => {
    expect(
      planTrace(
        [link('main', 'bim'), link('bim', 'lab'), link('lab', 'deep')],
        [link('main', 'bim'), link('bim', 'lab')],
      ),
    ).toEqual({ painted: 2, animate: false });
  });

  it('тот же маршрут и пустой маршрут — пробега нет', () => {
    expect(planTrace([link('main', 'bim')], [link('main', 'bim')])).toEqual({
      painted: 1,
      animate: false,
    });
    expect(planTrace([], [])).toEqual({ painted: 0, animate: false });
  });
});
