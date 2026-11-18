import { describe, expect, it } from 'vitest';
import { searchSourceTypeSchema } from '@nodus/contracts';

import {
  SEARCH_SOURCE_LIMITS,
  searchSourceDocumentSchema,
  searchSourceRowSchema,
  type SearchSourceRow,
} from './search-source.port.js';

/** Контракт документа проекции (#952, P0): провайдеры модулей-источников
 *  обязаны отдавать ровно эту форму — иначе индексатор пишет мусор. */

const baseRow: SearchSourceRow = {
  type: 'task',
  id: '8f1c1c1e-5a0f-4f2a-9d2e-3b7a6c1d0e11',
  title: 'Закупка труб',
  body: 'Описание задачи',
  keywords: 'ПП-123',
  projectId: null,
  conversationId: null,
  counterpartyId: null,
  authorId: null,
  participantIds: [],
  confidential: false,
  registered: true,
  aclKind: 'task',
  payload: { number: 123 },
  sourceCreatedAt: new Date('2026-11-01T09:00:00Z'),
  sourceUpdatedAt: new Date('2026-11-02T09:00:00Z'),
};

const ACL_BY_TYPE = {
  task: 'task',
  letter: 'letter',
  message: 'conversation',
  project: 'project',
  employee: 'portal',
} as const;

describe('SearchSourceDocument (контракт провайдера источников)', () => {
  it('принимает строку каждого из пяти типов с его aclKind', () => {
    for (const type of searchSourceTypeSchema.options) {
      const row = { ...baseRow, type, aclKind: ACL_BY_TYPE[type] };
      const parsed = searchSourceRowSchema.safeParse(row);
      expect(parsed.success, `${type}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('принимает tombstone без полей строки', () => {
    const parsed = searchSourceDocumentSchema.safeParse({
      type: 'letter',
      id: baseRow.id,
      deleted: true,
      sourceUpdatedAt: new Date(),
    });
    expect(parsed.success).toBe(true);
  });

  it('отвергает неизвестный тип и aclKind — закрытые множества', () => {
    expect(searchSourceRowSchema.safeParse({ ...baseRow, type: 'file' }).success).toBe(false);
    expect(searchSourceRowSchema.safeParse({ ...baseRow, aclKind: 'public' }).success).toBe(false);
  });

  it('держит пределы текста: title ≤ 500, body ≤ 4000', () => {
    expect(
      searchSourceRowSchema.safeParse({ ...baseRow, title: 'т'.repeat(SEARCH_SOURCE_LIMITS.title) })
        .success,
    ).toBe(true);
    expect(
      searchSourceRowSchema.safeParse({
        ...baseRow,
        title: 'т'.repeat(SEARCH_SOURCE_LIMITS.title + 1),
      }).success,
    ).toBe(false);
    expect(
      searchSourceRowSchema.safeParse({ ...baseRow, body: 'т'.repeat(SEARCH_SOURCE_LIMITS.body) })
        .success,
    ).toBe(true);
    expect(
      searchSourceRowSchema.safeParse({
        ...baseRow,
        body: 'т'.repeat(SEARCH_SOURCE_LIMITS.body + 1),
      }).success,
    ).toBe(false);
  });

  it('требует uuid в id и даты источника', () => {
    expect(searchSourceRowSchema.safeParse({ ...baseRow, id: 'не-uuid' }).success).toBe(false);
    expect(
      searchSourceRowSchema.safeParse({ ...baseRow, sourceCreatedAt: '2026-11-01' }).success,
    ).toBe(false);
  });
});
