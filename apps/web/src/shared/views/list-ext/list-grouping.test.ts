import { describe, expect, it } from 'vitest';

import { bucketRows, formatTotalValue } from './list-grouping.js';

const keyOf = (row: { g: string | number | null }) => row.g;

describe('bucketRows — раскладка строк по группам сервера (#435)', () => {
  it('строки расходятся по своим группам в порядке сервера', () => {
    const rows = [
      { g: 'b', id: '3' },
      { g: 'a', id: '1' },
      { g: 'b', id: '4' },
      { g: 'a', id: '2' },
    ];
    const groups = bucketRows(
      rows,
      [
        { key: 'a', count: 2, totals: [] },
        { key: 'b', count: 2, totals: [] },
      ],
      keyOf,
    );
    expect(groups.map((group) => group.key)).toEqual(['a', 'b']);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(groups[1]!.rows.map((r) => r.id)).toEqual(['3', '4']);
  });

  it('null-ключ — «без значения», строки не теряются', () => {
    const rows = [
      { g: null, id: '1' },
      { g: 'a', id: '2' },
    ];
    const groups = bucketRows(
      rows,
      [
        { key: 'a', count: 1, totals: [] },
        { key: null, count: 1, totals: [] },
      ],
      keyOf,
    );
    expect(groups.map((group) => group.key)).toEqual(['a', null]);
    expect(groups[1]!.rows).toEqual([{ g: null, id: '1' }]);
  });

  it('строка с ключом вне групп сервера попадает в импровизированную группу', () => {
    const rows = [
      { g: 'a', id: '1' },
      { g: 'zz', id: '2' },
    ];
    const groups = bucketRows(rows, [{ key: 'a', count: 1, totals: [] }], keyOf);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.key).toBe('zz');
    expect(groups[1]!.rows.map((r) => r.id)).toEqual(['2']);
  });

  it('formatTotalValue: null — тире, число — строкой', () => {
    expect(formatTotalValue(null)).toBe('—');
    expect(formatTotalValue(128)).toBe('128');
  });
});
