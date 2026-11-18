import { describe, expect, it } from 'vitest';

import { escapeLikePattern } from '../../core/database/like-pattern.js';
import { exactCondition } from './search-query.sql.js';

/**
 * Регресс security-аудита #952: в шаблонной строке TS `ESCAPE '\'` был
 * JS-escape и в SQL уходило `ESCAPE ''` — тогда `\%`/`\_` из
 * likePrefixPattern не экранировали wildcard (поиск «100%» / «лист_1»
 * промахивался точной ногой).
 */
describe('точная нога поиска (#952)', () => {
  it('передаёт в SQL ESCAPE-символ и экранированный префикс', () => {
    const sql = exactCondition({
      q: '100%',
      likePrefix: `${escapeLikePattern('100%')}%`,
      digits: null,
    });
    expect(sql.sql).toContain(`ESCAPE '\\'`);
    expect(sql.values).toContain('100\\%%');
  });

  it('подчёркивание тоже литерал', () => {
    const sql = exactCondition({
      q: 'лист_1',
      likePrefix: `${escapeLikePattern('лист_1')}%`,
      digits: null,
    });
    expect(sql.values).toContain('лист\\_1%');
  });
});
