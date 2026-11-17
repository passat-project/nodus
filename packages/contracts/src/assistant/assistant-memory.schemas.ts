import { z } from 'zod';

import { ASSISTANT_LIMITS } from './assistant-limits.js';

/**
 * Личная память сотрудника (#900): блокнот агента. Видит только владелец;
 * запись делает агент, сотрудник может удалить (архивация, не стирание).
 * Память не влияет на права — это подсказки о предпочтениях, а не команды.
 */

export const assistantMemorySchema = z.object({
  id: z.uuid(),
  text: z.string().min(1).max(ASSISTANT_LIMITS.maxMemoryChars),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AssistantMemory = z.infer<typeof assistantMemorySchema>;

export const assistantMemoryListSchema = z.object({
  items: z.array(assistantMemorySchema),
  /** Лимит активных записей — интерфейс показывает «N из 50». */
  limit: z.number().int().positive(),
});
export type AssistantMemoryList = z.infer<typeof assistantMemoryListSchema>;
