import { describe, expect, it } from 'vitest';

import { listConversationsQuerySchema, sendMessageBodySchema } from './chat.schemas.js';

const ATTACHMENT = '11111111-1111-4111-8111-111111111111';
const STICKER = '22222222-2222-4222-8222-222222222222';

describe('sendMessageBodySchema: текст необязателен при вложении/стикере', () => {
  it('сообщение только с файлом валидно, text нормализуется в пустую строку', () => {
    const parsed = sendMessageBodySchema.safeParse({ attachmentIds: [ATTACHMENT] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.text).toBe('');
  });

  it('сообщение только со стикером валидно', () => {
    expect(sendMessageBodySchema.safeParse({ stickerId: STICKER }).success).toBe(true);
  });

  it('совсем пустое сообщение по-прежнему отклоняется', () => {
    expect(sendMessageBodySchema.safeParse({}).success).toBe(false);
    expect(sendMessageBodySchema.safeParse({ text: '   ' }).success).toBe(false);
  });
});

describe('listConversationsQuerySchema: срез списка бесед', () => {
  it('scope=direct — только личные беседы (точечный поиск собеседника)', () => {
    const parsed = listConversationsQuerySchema.safeParse({ scope: 'direct', search: 'Анна' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.scope).toBe('direct');
  });

  it('без scope — all; неизвестный срез отклоняется', () => {
    expect(listConversationsQuerySchema.parse({}).scope).toBe('all');
    expect(listConversationsQuerySchema.safeParse({ scope: 'personal' }).success).toBe(false);
  });
});
