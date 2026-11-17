import type { AssistantSession } from '@nodus/contracts';

/** Сессия для тестов AssistantBody: вынесена, чтобы файл тестов был ≤ 300 строк. */
export const SESSION: AssistantSession = {
  id: 's-1',
  title: 'Диалог о письмах',
  archived: false,
  createdAt: '2026-11-17T08:00:00.000Z',
  updatedAt: '2026-11-17T09:00:00.000Z',
  lastMessageAt: '2026-11-17T09:00:00.000Z',
  messageCount: 2,
};
