import { describe, expect, it, vi } from 'vitest';

import { chatDirectMessageTool } from './definitions/chat-write.tools.js';
import { ToolExecutorService } from './tool-executor.service.js';

/**
 * Цепочка записи (#921): `chat.direct_message` — find-or-create личного чата,
 * затем отправка. Тест держит идемпотентность шагов (`cardId`, `cardId:2`) и
 * форму `data={steps, result}` для «Отменить»; права/валидация — на API.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';

function makeExecutor(inject: ReturnType<typeof vi.fn>) {
  const fastify = { inject };
  const adapterHost = { httpAdapter: { getInstance: () => fastify } };
  return new ToolExecutorService(adapterHost as never);
}

describe('ToolExecutorService.executeWrite: цепочка шагов (#921)', () => {
  it('чат → сообщение: два шага, ключи идемпотентности по порядку, data для undo', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ id: CONVERSATION_ID }) })
      .mockResolvedValueOnce({
        statusCode: 201,
        body: JSON.stringify({ id: MESSAGE_ID, conversationId: CONVERSATION_ID }),
      });
    const executor = makeExecutor(inject);

    const result = await executor.executeWrite(
      chatDirectMessageTool,
      { userId: USER_ID, text: 'Привет' },
      'Bearer token',
      'card-1',
    );

    expect(result.ok).toBe(true);
    expect(inject).toHaveBeenCalledTimes(2);
    expect(inject.mock.calls[0]![0]).toMatchObject({
      method: 'POST',
      url: `/api/v1/chat/conversations/direct/${USER_ID}`,
      headers: expect.objectContaining({ 'idempotency-key': 'card-1' }),
    });
    expect(inject.mock.calls[1]![0]).toMatchObject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${CONVERSATION_ID}/messages`,
      headers: expect.objectContaining({ 'idempotency-key': 'card-1:2' }),
    });
    if (result.ok) {
      expect(result.text).toContain('Личное сообщение отправлено');
      expect(result.data).toEqual({
        steps: [{ id: CONVERSATION_ID }, { id: MESSAGE_ID, conversationId: CONVERSATION_ID }],
        result: { id: MESSAGE_ID, conversationId: CONVERSATION_ID },
      });
    }
  });

  it('сбой второго шага — ошибка без третьего запроса', async () => {
    const inject = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ id: CONVERSATION_ID }) })
      .mockResolvedValueOnce({
        statusCode: 403,
        body: JSON.stringify({ code: 'FORBIDDEN', message: 'Запрещено' }),
      });
    const executor = makeExecutor(inject);

    const result = await executor.executeWrite(
      chatDirectMessageTool,
      { userId: USER_ID, text: 'Привет' },
      'Bearer token',
      'card-2',
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'FORBIDDEN' });
    expect(inject).toHaveBeenCalledTimes(2);
  });
});
