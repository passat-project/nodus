import { describe, expect, it } from 'vitest';

import { groupTransferHints } from './transfer-hints.js';

/**
 * #817: подсказка о переводе — одной строкой на прежнее подразделение
 * (сотрудники из одного места перечисляются через запятую).
 */
describe('groupTransferHints', () => {
  it('сотрудники из одного отдела — одна группа, порядок первого вхождения', () => {
    const groups = groupTransferHints([
      { name: 'Маторин Артём', fromName: 'ПассатПроект' },
      { name: 'Клемантович Денис', fromName: 'ПассатПроект' },
      { name: 'Воронич Алина', fromName: 'BIM-отдел' },
    ]);

    expect(groups).toEqual([
      { fromName: 'ПассатПроект', names: ['Маторин Артём', 'Клемантович Денис'] },
      { fromName: 'BIM-отдел', names: ['Воронич Алина'] },
    ]);
  });

  it('сотрудники без подразделения — отдельная группа', () => {
    expect(
      groupTransferHints([
        { name: 'Анна Ночная', fromName: null },
        { name: 'Борис Ночной', fromName: null },
      ]),
    ).toEqual([{ fromName: null, names: ['Анна Ночная', 'Борис Ночной'] }]);
  });

  it('пустой список — пустые группы', () => {
    expect(groupTransferHints([])).toEqual([]);
  });
});
