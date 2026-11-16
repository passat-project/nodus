import { assistantRunEventDataSchema, assistantRunEventTypeSchema } from '@nodus/contracts';

/**
 * Разбор потока прогона в браузере (#895, ADR-0043 п. 6): `fetch` +
 * `ReadableStream` вместо `EventSource` — нужен заголовок `Authorization`
 * (Bearer), которого EventSource не умеет.
 *
 * Формат: кадры `id:` / `type:` / `data:` (Nest `@Sse`); данные — JSON с
 * полем `type`. Восстановление после обрыва — повторный запрос с
 * `Last-Event-ID`: сервер отдаст пропущенные события.
 */

export interface StreamEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

/** Один кадр SSE → событие прогона; мусор отбрасывается молча. */
export function parseSseFrame(frame: {
  id?: string;
  event?: string;
  data: string;
}): StreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data) as unknown;
  } catch {
    return null;
  }
  const payload = parsed as Record<string, unknown>;
  const type = assistantRunEventTypeSchema.safeParse(payload.type ?? frame.event);
  if (!type.success) return null;
  const id = Number(frame.id ?? payload.seq ?? 0);
  return {
    id: Number.isFinite(id) ? id : 0,
    type: type.data,
    data: payload,
  };
}

/** Проверка формы данных события (для редьюсера ленты). */
export function parseRunEventData(data: unknown) {
  return assistantRunEventDataSchema.safeParse(data);
}

/** Разбор чанков транспорта в кадры (аналог серверного SseParser). */
export class SseFrameParser {
  private buffer = '';

  push(chunk: string): { id?: string; event?: string; data: string }[] {
    this.buffer += chunk;
    const frames: { id?: string; event?: string; data: string }[] = [];
    // Граница блока — пустая строка; прокси и провайдеры шлют и \n\n, и \r\n\r\n.
    const boundary = /\r?\n\r?\n/;
    let match = boundary.exec(this.buffer);
    while (match) {
      const block = this.buffer.slice(0, match.index).replace(/\r\n/g, '\n');
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const frame = parseBlock(block);
      if (frame) frames.push(frame);
      match = boundary.exec(this.buffer);
    }
    return frames;
  }
}

function parseBlock(block: string): { id?: string; event?: string; data: string } | null {
  const data: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { id, event, data: data.join('\n') };
}
