import { describe, expect, it } from 'vitest';

import { SseParser } from './sse-parser.js';

/**
 * Разбор SSE-потока Chat Completions (ADR-0044: без SDK). Транспорт режет
 * блоки произвольно — парсер обязан собирать кадры из любых чанков и не
 * терять хвост при закрытии потока.
 */

describe('SseParser', () => {
  it('собирает кадры из целых блоков и терминатор [DONE]', () => {
    const parser = new SseParser();
    const frames = parser.push('data: {"a":1}\n\ndata: [DONE]\n\n');
    expect(frames.map((frame) => frame.data)).toEqual(['{"a":1}', '[DONE]']);
  });

  it('склеивает блок, разрезанный посреди строки', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"cho')).toEqual([]);
    const frames = parser.push('ices":[]}\n\n');
    expect(frames.map((frame) => frame.data)).toEqual(['{"choices":[]}']);
  });

  it('понимает CRLF и служебные поля event/id', () => {
    const parser = new SseParser();
    const frames = parser.push('id: 7\r\nevent: delta\r\ndata: {"x":1}\r\n\r\n');
    expect(frames).toEqual([{ id: '7', event: 'delta', data: '{"x":1}' }]);
  });

  it('несколько data-строк в блоке склеиваются через \\n (спека SSE)', () => {
    const parser = new SseParser();
    const frames = parser.push('data: a\ndata: b\n\n');
    expect(frames[0]?.data).toBe('a\nb');
  });

  it('комментарии keep-alive и пустые блоки пропускаются', () => {
    const parser = new SseParser();
    const frames = parser.push(': keep-alive\n\ndata: x\n\n\n\n');
    expect(frames.map((frame) => frame.data)).toEqual(['x']);
  });

  it('flush отдаёт хвост без завершающей пустой строки', () => {
    const parser = new SseParser();
    expect(parser.push('data: tail')).toEqual([]);
    expect(parser.flush().map((frame) => frame.data)).toEqual(['tail']);
  });
});
