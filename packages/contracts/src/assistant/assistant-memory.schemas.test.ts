import { describe, expect, it } from 'vitest';

import { ASSISTANT_LIMITS } from './assistant-limits.js';
import { assistantMemoryListSchema, assistantMemorySchema } from './assistant-memory.schemas.js';

/**
 * Блокнот агента (#900): одна запись до 300 знаков, список с серверным
 * лимитом — интерфейс показывает «N из 50».
 */

const ISO = '2026-11-27T10:00:00.000Z';
const memory = {
  id: '11111111-1111-4111-8111-111111111111',
  text: 'Отчёты — по пятницам',
  createdAt: ISO,
  updatedAt: ISO,
};

describe('assistantMemorySchema (#900)', () => {
  it('запись и список с лимитом', () => {
    expect(assistantMemorySchema.parse(memory)).toEqual(memory);
    expect(
      assistantMemoryListSchema.parse({ items: [memory], limit: ASSISTANT_LIMITS.maxMemories })
        .items,
    ).toHaveLength(1);
  });

  it('пустая и слишком длинная запись отклоняются', () => {
    expect(assistantMemorySchema.safeParse({ ...memory, text: '' }).success).toBe(false);
    expect(
      assistantMemorySchema.safeParse({
        ...memory,
        text: 'я'.repeat(ASSISTANT_LIMITS.maxMemoryChars + 1),
      }).success,
    ).toBe(false);
  });
});
