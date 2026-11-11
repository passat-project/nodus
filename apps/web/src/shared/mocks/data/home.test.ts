import { describe, expect, it } from 'vitest';

import { demoStats } from './home.js';
import { demoUserListItems } from './users.js';

/**
 * Мок-контур (#723): показатель «Сотрудники» выводится из демо-справочника, а
 * не литералом — расхождение с разделом «Сотрудники» на моках невозможно.
 */

describe('demoStats (#723)', () => {
  it('employeeCount — только действующие: уволенный демо-сотрудник в штат не входит', () => {
    const active = demoUserListItems.filter((user) => user.status === 'active').length;
    const dismissed = demoUserListItems.filter((user) => user.status === 'deactivated').length;

    // В демо-справочнике есть уволенный — иначе тест нечувствителен к фильтру:
    // без `status === 'active'` число стало бы длиной списка.
    expect(dismissed).toBeGreaterThan(0);
    expect(demoStats.employeeCount).toBe(active);
    expect(demoStats.employeeCount).toBe(demoUserListItems.length - dismissed);
  });

  it('проекты и узлы данных — честные нули: на бэке источников нет', () => {
    // Живой `/home/summary` отдаёт те же нули; демо-числа не маскируются под
    // реальные (вердикт владельца 01.10).
    expect(demoStats.projectsDone).toBe(0);
    expect(demoStats.dataNodes).toBe(0);
  });
});
