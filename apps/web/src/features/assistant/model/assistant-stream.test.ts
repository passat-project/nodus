import { describe, expect, it } from 'vitest';

import { parseRunEventData, parseSseFrame, SseFrameParser } from './assistant-stream.js';

/**
 * Разбор потока прогона в браузере (#895): кадры режутся произвольно,
 * `[DONE]`-мусор и незнакомые типы отбрасываются, данные валидируются
 * контрактом — редьюсер ленты никогда не получает полусобытие.
 */

describe('SseFrameParser', () => {
  it('собирает кадры из разрезанных чанков', () => {
    const parser = new SseFrameParser();
    expect(parser.push('id: 1\nevent: message.delta\ndata: {"te')).toEqual([]);
    const frames = parser.push('xt":"а","type":"message.delta","seq":1}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: '1', event: 'message.delta' });
  });

  it('несколько кадров в одном чанке и CRLF', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('id: 1\ndata: {"seq":1}\r\n\r\nid: 2\ndata: {"seq":2}\r\n\r\n');
    expect(frames.map((frame) => frame.id)).toEqual(['1', '2']);
  });

  it('комментарии keep-alive пропускаются', () => {
    const parser = new SseFrameParser();
    expect(parser.push(': ping\n\ndata: {"x":1}\n\n')).toHaveLength(1);
  });
});

describe('parseSseFrame', () => {
  it('принимает событие прогона с типом и seq', () => {
    const event = parseSseFrame({
      id: '7',
      data: JSON.stringify({ type: 'message.delta', text: 'привет', seq: 7 }),
    });
    expect(event).toEqual({
      id: 7,
      type: 'message.delta',
      data: { type: 'message.delta', text: 'привет', seq: 7 },
    });
  });

  it('незнакомый тип и битый JSON — null, а не исключение', () => {
    expect(parseSseFrame({ data: '{"type":"nope"}' })).toBeNull();
    expect(parseSseFrame({ data: 'не json' })).toBeNull();
  });
});

describe('parseRunEventData', () => {
  it('валидирует полезную нагрузку по типу', () => {
    expect(parseRunEventData({ type: 'reasoning.delta', text: 'думаю' }).success).toBe(true);
    expect(parseRunEventData({ type: 'tool.started', toolId: 'tasks.list' }).success).toBe(false);
    expect(
      parseRunEventData({
        type: 'tool.finished',
        toolCallId: '11111111-1111-4111-8111-111111111111',
        toolId: 'tasks.list',
        status: 'done',
        resultPreview: 'ok',
        durationMs: 12,
        errorCode: null,
        href: null,
        hrefLabel: null,
      }).success,
    ).toBe(true);
  });

  it('ошибка прогона несёт код и признак повтора', () => {
    const parsed = parseRunEventData({
      type: 'run.error',
      code: 'provider_rate_limited',
      message: 'wait',
      retryable: true,
    });
    expect(parsed.success).toBe(true);
  });
});
