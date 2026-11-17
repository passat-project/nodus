/**
 * Разбор Server-Sent Events из потока Chat Completions (ADR-0044: без SDK —
 * native fetch и ручной разбор). Чистая функция без сети: тестируется на
 * строках, а не на моках fetch.
 *
 * Формат SSE (WHATWG): блоки разделяются пустой строкой; строка `data: X`
 * несёт данные, `event: X` — имя события, `id: X` — идентификатор.
 * Провайдеры OpenAI-совместимого формата шлют только `data:` и терминатор
 * `data: [DONE]`.
 */
export interface SseFrame {
  event: string | null;
  id: string | null;
  data: string;
}

/**
 * Потоковый парсер: чанки транспортного потока могут резать блоки
 * произвольно (в том числе посреди UTF-8-последовательности, если читать
 * байтами — поэтому сюда приходит уже декодированный текст).
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    // Блок отделяется пустой строкой; CRLF нормализуем (провайдеры шлют оба).
    let boundary = findBlockBoundary(this.buffer);
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary.index).replace(/\r\n/g, '\n');
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      const frame = parseBlock(block);
      if (frame) frames.push(frame);
      boundary = findBlockBoundary(this.buffer);
    }
    return frames;
  }

  /** Хвост без завершающей пустой строки — при закрытии потока. */
  flush(): SseFrame[] {
    const rest = this.buffer.replace(/\r\n/g, '\n');
    this.buffer = '';
    const frame = rest.trim() ? parseBlock(rest) : null;
    return frame ? [frame] : [];
  }
}

function findBlockBoundary(buffer: string): { index: number; length: number } | -1 {
  const crlf = buffer.indexOf('\r\n\r\n');
  const lf = buffer.indexOf('\n\n');
  if (crlf === -1 && lf === -1) return -1;
  if (lf === -1) return { index: crlf, length: 4 };
  if (crlf === -1) return { index: lf, length: 2 };
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

/** Блок → кадр; комментарии (`: keep-alive`) и пустые блоки пропускаются. */
function parseBlock(block: string): SseFrame | null {
  let event: string | null = null;
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0 && !event) return null;
  return { event, id, data: data.join('\n') };
}
