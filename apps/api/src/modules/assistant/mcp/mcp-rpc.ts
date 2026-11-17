import { asRecord } from '../tools/projections.js';

/** JSON-RPC сообщение MCP: id/result/error (транспортный конверт). */
export interface RpcMessage {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** Тело ответа → JSON-RPC сообщение; мусор/не-объект — null, а не падение. */
export function parseRpcMessage(raw: string): RpcMessage | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return asRecord(value) ? (value as RpcMessage) : null;
  } catch {
    return null;
  }
}

/** Конец SSE-кадра: пустая строка (LF или CRLF). */
export function frameBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

/** Кадр SSE → JSON-RPC сообщение; комментарии/битые кадры пропускаются. */
export function parseFrame(frame: string): RpcMessage | null {
  let data = '';
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(':') || !line.startsWith('data:')) continue;
    data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
  }
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return asRecord(parsed) ? (parsed as RpcMessage) : null;
  } catch {
    return null;
  }
}
