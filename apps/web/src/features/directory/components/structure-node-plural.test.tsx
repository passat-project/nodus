// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { plural } from '../../../shared/lib/format.js';

describe('плюральные формы карточки (#768)', () => {
  it('«сотрудник»: 0/1/2/5/11/21', () => {
    const forms = ui.employees.employeeForms;
    expect([0, 1, 2, 5, 11, 21].map((n) => plural(n, forms))).toEqual([
      'сотрудников',
      'сотрудник',
      'сотрудника',
      'сотрудников',
      'сотрудников',
      'сотрудник',
    ]);
  });

  it('«подразделение»: 0/1/2/5/11/21', () => {
    const forms = ui.employees.departmentForms;
    expect([0, 1, 2, 5, 11, 21].map((n) => plural(n, forms))).toEqual([
      'подразделений',
      'подразделение',
      'подразделения',
      'подразделений',
      'подразделений',
      'подразделение',
    ]);
  });
});
