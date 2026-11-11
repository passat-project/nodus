import { describe, expect, it } from 'vitest';

import { employeeListFields } from './employee-fields.js';

/**
 * Реестр колонок «Сотрудники» (#723): HR-статус виден по умолчанию — шапка
 * считает штат (действующих), журнал показывает и уволенных, и колонка
 * объясняет разницу без захода в настройки вида.
 */
describe('employeeListFields: колонка статуса (#723)', () => {
  it('статус видим по умолчанию', () => {
    const status = employeeListFields(new Map()).find((field) => field.id === 'status');

    expect(status?.defaultVisible).toBe(true);
  });
});
