import { describe, expect, it } from 'vitest';

import { chatMessageReadPayloadSchema } from './chat-events.js';

/** Область квитанции чтения (#1026): без threadRootId — лента беседы,
 *  uuid — ответы треда. Поле необязательное ради старых продюсеров. */
describe('chatMessageReadPayloadSchema: область чтения (#1026)', () => {
  const base = {
    conversationId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    upToSeq: 9,
    readAt: '2026-11-25T10:00:00.000Z',
  };

  it('квитанция ленты без threadRootId валидна (совместимость)', () => {
    expect(chatMessageReadPayloadSchema.parse(base)).toEqual(base);
  });

  it('threadRootId=null — явная лента', () => {
    expect(chatMessageReadPayloadSchema.parse({ ...base, threadRootId: null })).toMatchObject({
      threadRootId: null,
    });
  });

  it('threadRootId=uuid — область треда', () => {
    const threadRootId = '00000000-0000-4000-8000-0000000000aa';
    expect(chatMessageReadPayloadSchema.parse({ ...base, threadRootId })).toMatchObject({
      threadRootId,
    });
  });

  it('threadRootId не uuid — отклоняется', () => {
    expect(() => chatMessageReadPayloadSchema.parse({ ...base, threadRootId: 'root-1' })).toThrow();
  });
});
