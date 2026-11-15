import { describe, expect, it } from 'vitest';

import { sendMessageBodySchema } from './chat.schemas.js';

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
