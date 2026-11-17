import { describe, expect, it } from 'vitest';

import { assistantRunEventDataSchema, assistantRunEventSchema } from './assistant.schemas.js';

/**
 * События SSE ассистента (#889): клиент разбирает поток этими схемами —
 * расхождение здесь означает «пустой ответ» в ленте. Вынесено из
 * `assistant.schemas.test.ts` по I5; форма карточек действий остаётся там.
 */

const UUID = '11111111-1111-4111-8111-111111111111';
const ISO = '2026-11-17T10:00:00.000Z';

describe('assistantRunEventDataSchema: события SSE (#889)', () => {
  it('delta-события несут текст', () => {
    expect(assistantRunEventDataSchema.parse({ type: 'message.delta', text: 'при' })).toEqual({
      type: 'message.delta',
      text: 'при',
    });
    expect(assistantRunEventDataSchema.parse({ type: 'reasoning.delta', text: 'думаю' }).type).toBe(
      'reasoning.delta',
    );
  });

  it('старт прогона и вызов инструмента', () => {
    expect(
      assistantRunEventDataSchema.parse({ type: 'run.started', messageId: UUID, model: null }),
    ).toMatchObject({ type: 'run.started', model: null });
    const started = assistantRunEventDataSchema.parse({
      type: 'tool.started',
      toolCallId: UUID,
      toolId: 'tasks.list',
      title: 'Задачи: список',
      args: null,
    });
    expect(started.type).toBe('tool.started');
    const finished = assistantRunEventDataSchema.parse({
      type: 'tool.finished',
      toolCallId: UUID,
      toolId: 'tasks.list',
      status: 'error',
      resultPreview: null,
      durationMs: null,
      errorCode: 'FORBIDDEN',
      href: null,
      hrefLabel: null,
    });
    expect(finished).toMatchObject({ type: 'tool.finished', status: 'error' });
  });

  it('финал, ошибка и отмена', () => {
    expect(
      assistantRunEventDataSchema.parse({
        type: 'message.completed',
        messageId: UUID,
        text: 'Ответ',
        reasoning: null,
      }).type,
    ).toBe('message.completed');
    expect(
      assistantRunEventDataSchema.parse({
        type: 'run.completed',
        inputTokens: 10,
        outputTokens: 20,
      }),
    ).toMatchObject({ type: 'run.completed', outputTokens: 20 });
    expect(
      assistantRunEventDataSchema.safeParse({ type: 'run.error', code: '', message: 'x' }).success,
    ).toBe(false);
    expect(
      assistantRunEventDataSchema.parse({
        type: 'run.error',
        code: 'ASSISTANT_PROVIDER_UNAVAILABLE',
        message: 'Сеть',
        retryable: true,
      }),
    ).toMatchObject({ retryable: true });
    expect(assistantRunEventDataSchema.parse({ type: 'run.cancelled' }).type).toBe('run.cancelled');
  });

  it('tool.finished несёт человеческое название (лента не показывает сырой id)', () => {
    const parsed = assistantRunEventDataSchema.parse({
      type: 'tool.finished',
      toolCallId: UUID,
      toolId: 'memory.save',
      title: 'Блокнот: запомнить',
      status: 'done',
      resultPreview: 'Записано',
      durationMs: 6,
      errorCode: null,
      href: null,
      hrefLabel: null,
    });
    expect(parsed).toMatchObject({ title: 'Блокнот: запомнить' });
  });

  it('неизвестный тип события отклоняется — клиент не рисует неизвестное', () => {
    expect(assistantRunEventDataSchema.safeParse({ type: 'run.exploded' }).success).toBe(false);
  });

  it('событие потока: seq, тип, данные и время', () => {
    const event = { seq: 7, type: 'message.delta', data: { text: 'при' }, createdAt: ISO };
    expect(assistantRunEventSchema.parse(event)).toEqual(event);
    expect(assistantRunEventSchema.safeParse({ ...event, seq: -1 }).success).toBe(false);
  });
});
