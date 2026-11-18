import { describe, expect, it } from 'vitest';

import type { SearchHit } from '@nodus/contracts';
import {
  searchHitDate,
  searchHitMeta,
  searchHitPrimary,
  searchHitSnippet,
} from './search-hit-row.js';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  score: 0.9,
  match: 'exact' as const,
  reasons: ['title'] as SearchHit['reasons'],
  sourceCreatedAt: '2026-11-10T09:00:00.000Z',
};

const task: SearchHit = {
  ...base,
  type: 'task',
  title: 'Согласовать смету',
  snippet: 'Согласовать смету',
  meta: {
    number: 101,
    projectId: '22222222-2222-4222-8222-222222222222',
    projectName: 'Альфа',
    deadline: null,
  },
};

const employee: SearchHit = {
  ...base,
  type: 'employee',
  title: 'Иванов Иван',
  snippet: 'Иванов',
  meta: { positionName: 'Инженер', departmentName: 'ПТО', email: 'ivanov@example.com' },
};

describe('строка выдачи (#952)', () => {
  it('сниппет-дубль названия не показывается: второй слой — контекст', () => {
    expect(searchHitSnippet(task)).toBeNull();
    expect(searchHitMeta(task)).toBe('ПП-101 · Альфа');
  });

  it('сниппет из текста показывается вместо контекста', () => {
    const hit: SearchHit = { ...task, snippet: 'окно со \u0001сметой\u0002 на раздел' };
    expect(searchHitSnippet(hit)).not.toBeNull();
  });

  it('первая строка сообщения — контекст беседы, а не текст', () => {
    const message: SearchHit = {
      ...base,
      type: 'message',
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Привет',
      snippet: 'Привет',
      meta: {
        conversationId: '44444444-4444-4444-8444-444444444444',
        conversationType: 'task',
        conversationLabel: 'чат задачи ПП-101',
        taskNumber: 101,
        regNumber: null,
        messageId: '55555555-5555-4555-8555-555555555555',
        seq: 12,
        threadRootId: null,
        authorId: '66666666-6666-4666-8666-666666666666',
        authorName: 'Петров',
        createdAt: '2026-11-11T10:00:00.000Z',
      },
    };
    expect(searchHitPrimary(message)).toBe('чат задачи ПП-101');
    expect(searchHitMeta(message)).toBe('Петров');
  });

  it('дата стоит справа первой строки; у сотрудника даты нет', () => {
    expect(searchHitDate(task)).not.toBeNull();
    expect(searchHitDate(employee)).toBeNull();
  });
});
