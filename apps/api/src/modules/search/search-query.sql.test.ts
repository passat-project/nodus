import { describe, expect, it } from 'vitest';

import { Prisma } from '../../generated/prisma/client.js';
import { escapeLikePattern } from '../../core/database/like-pattern.js';
import { buildPageSql, exactCondition, type SearchSqlParams } from './search-query.sql.js';

const params = (): SearchSqlParams => ({
  q: 'смета',
  likePrefix: 'смета%',
  digits: null,
  actorId: '11111111-1111-4111-8111-111111111111',
  enabledTypes: ['task', 'message'],
  types: ['task', 'message'],
  visibility: Prisma.empty,
  counterpartyIds: [],
  sort: 'relevance',
  cursor: null,
  limit: 20,
});

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

describe('фильтр беседы (#956)', () => {
  const conversationId = '8f1c1c1e-5a0f-4f2a-9d2e-3b7a6c1d0e11';

  it('без conversationId SQL не сужает выдачу', () => {
    expect(buildPageSql(params()).sql).not.toContain('doc.conversation_id');
  });

  it('с conversationId — pre-filter во всех ногах и счётчиках', () => {
    const sql = buildPageSql({ ...params(), conversationId });
    // baseFilter инлайнится в каждую ногу CTE (exact/fts/trgm).
    expect(sql.sql.match(/doc\.conversation_id/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.values).toContain(conversationId);
  });
});
