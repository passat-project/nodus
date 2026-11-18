import { describe, expect, it } from 'vitest';

import {
  SEARCH_LIMITS,
  searchHitSchema,
  searchRequestSchema,
  searchResponseSchema,
} from './search.schemas.js';

/** Контракт поиска (#952): форма запроса и выдачи замораживается на UI-чекпоинте
 *  P1 — тесты фиксируют defaults, пределы и дискриминированный union. */

const hitBase = {
  id: '8f1c1c1e-5a0f-4f2a-9d2e-3b7a6c1d0e11',
  title: 'Закупка труб',
  snippet: 'трубы \u0001стальные\u0002',
  score: 0.72,
  match: 'exact' as const,
  reasons: ['title' as const],
  sourceCreatedAt: '2026-11-01T09:00:00.000Z',
};

describe('searchRequestSchema', () => {
  it('требует q ≥ 2 и подставляет defaults (limit 20, sort relevance)', () => {
    expect(searchRequestSchema.safeParse({ q: 'т' }).success).toBe(false);
    const parsed = searchRequestSchema.parse({ q: '  труба  ' });
    expect(parsed).toEqual({ q: 'труба', sort: 'relevance', limit: 20 });
  });

  it('принимает непустой types? без дублей и не больше пяти типов', () => {
    expect(searchRequestSchema.safeParse({ q: 'труба', types: [] }).success).toBe(false);
    expect(
      searchRequestSchema.safeParse({ q: 'труба', types: ['task', 'letter', 'message'] }).success,
    ).toBe(true);
    expect(searchRequestSchema.safeParse({ q: 'труба', types: ['task', 'task'] }).success).toBe(
      false,
    );
    expect(
      searchRequestSchema.safeParse({
        q: 'труба',
        types: ['task', 'task', 'letter', 'message', 'project', 'employee'],
      }).success,
    ).toBe(false);
  });

  it('limit — число из query-строки, 1..50', () => {
    expect(searchRequestSchema.parse({ q: 'труба', limit: '35' }).limit).toBe(35);
    expect(searchRequestSchema.safeParse({ q: 'труба', limit: '0' }).success).toBe(false);
    expect(
      searchRequestSchema.safeParse({ q: 'труба', limit: String(SEARCH_LIMITS.limitMax + 1) })
        .success,
    ).toBe(false);
  });

  it('period — даты YYYY-MM-DD, sort — только два значения', () => {
    expect(searchRequestSchema.safeParse({ q: 'труба', from: '2026-11-01' }).success).toBe(true);
    expect(searchRequestSchema.safeParse({ q: 'труба', from: '01.11.2026' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ q: 'труба', sort: 'popular' }).success).toBe(false);
  });
});

describe('searchHitSchema', () => {
  it('разбирает каждый тип со своей meta', () => {
    const hits = [
      {
        ...hitBase,
        type: 'task',
        meta: { number: 123, projectId: null, projectName: null, deadline: null },
      },
      {
        ...hitBase,
        type: 'letter',
        meta: {
          regNumber: 'Вх-2026/431',
          counterpartyId: null,
          counterpartyName: null,
          direction: 'incoming',
        },
      },
      {
        ...hitBase,
        type: 'message',
        meta: {
          conversationId: hitBase.id,
          conversationType: 'task',
          conversationLabel: 'чат задачи ПП-123',
          taskNumber: 123,
          regNumber: null,
          messageId: hitBase.id,
          seq: 42,
          threadRootId: null,
          authorId: null,
          authorName: null,
          createdAt: '2026-11-01T09:00:00.000Z',
        },
      },
      { ...hitBase, type: 'project', meta: { code: 'АР-12', status: 'active' } },
      {
        ...hitBase,
        type: 'employee',
        meta: { positionName: null, departmentName: null, email: null },
      },
    ];
    for (const hit of hits) {
      expect(searchHitSchema.safeParse(hit).success, hit.type).toBe(true);
    }
  });

  it('лишние поля meta отбрасываются, обязательные — нет; причина только из каталога', () => {
    expect(
      searchHitSchema.safeParse({
        ...hitBase,
        type: 'project',
        meta: { code: null, status: 'active', number: 1 },
      }).success,
    ).toBe(true); // zod-объект отбрасывает лишнее — форма стабильна
    expect(searchHitSchema.safeParse({ ...hitBase, type: 'task', meta: {} }).success).toBe(false);
    expect(searchHitSchema.safeParse({ ...hitBase, type: 'task', meta: null }).success).toBe(false);
    expect(
      searchHitSchema.safeParse({ ...hitBase, type: 'task', meta: {}, reasons: ['popular'] })
        .success,
    ).toBe(false);
  });

  it('score — 0..1, а не сырой rank', () => {
    const projectHit = { ...hitBase, type: 'project', meta: { code: null, status: 'active' } };
    expect(searchHitSchema.safeParse({ ...projectHit, score: 1 }).success).toBe(true);
    expect(searchHitSchema.safeParse({ ...projectHit, score: 1.2 }).success).toBe(false);
  });
});

describe('searchResponseSchema', () => {
  it('принимает пустую выдачу с подсказкой и частичные фасеты', () => {
    const parsed = searchResponseSchema.safeParse({
      items: [],
      nextCursor: null,
      total: 0,
      totalCapped: false,
      facets: { types: { task: 3 } },
      hint: 'index_empty',
      tookMs: 12,
    });
    expect(parsed.success).toBe(true);
  });

  it('фасеты не принимают неизвестный тип', () => {
    expect(
      searchResponseSchema.safeParse({
        items: [],
        nextCursor: null,
        total: 0,
        totalCapped: false,
        facets: { types: { file: 1 } },
        hint: null,
        tookMs: 1,
      }).success,
    ).toBe(false);
  });
});
