import { describe, expect, it } from 'vitest';

import { clientProjectsUrl, counterpartyRelationsKeys } from './counterparty-relations.js';

/** AUD-028 (#866): вкладка «Проекты» контрагента — тот же срез видимости. */
describe('адрес вкладки «Проекты» карточки контрагента (#866, AUD-028)', () => {
  it('scope=all вместе с clientId', () => {
    const url = clientProjectsUrl('00000000-0000-4000-8000-000000000002');
    expect(url).toContain('clientId=00000000-0000-4000-8000-000000000002');
    expect(url).toContain('scope=all');
  });

  it('серверный поиск проектов заказчика (#956)', () => {
    const url = clientProjectsUrl('00000000-0000-4000-8000-000000000002', 'Смета');
    expect(url).toContain(`search=${encodeURIComponent('Смета')}`);
    expect(clientProjectsUrl('00000000-0000-4000-8000-000000000002', ' ')).not.toContain('search=');
  });
});

describe('ключ вкладки «Проекты» контрагента (#956)', () => {
  it('без поиска — канонический ключ, с поиском — отдельная ветка', () => {
    expect(counterpartyRelationsKeys.projects('c-1')).toEqual(['projects', 'client', 'c-1']);
    expect(counterpartyRelationsKeys.projects('c-1', 'Смета')).toEqual([
      'projects',
      'client',
      'c-1',
      { search: 'Смета' },
    ]);
  });
});
