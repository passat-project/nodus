import { asRecord, str } from '../tools/projections.js';

/**
 * Минимальный клиент MCP (Streamable HTTP) для внешних серверов ассистента
 * (#902/#901, ADR-0043 п. 10). Без SDK: нужны только `initialize`,
 * `tools/list` и `tools/call`, а «тяжёлый клиент» здесь — лишняя зависимость.
 *
 * Механика по спецификации 2025-06-18 (и совместимо с 2025-03-26):
 * - POST с `Accept: application/json, text/event-stream` — иначе сервер
 *   отвечает 406 ещё до handshake;
 * - ответ приходит либо JSON, либо SSE-потоком; читаем поток инкрементально
 *   и останавливаемся на своём `id` (уведомления/progress не наш результат);
 * - после `initialize` обязательна нотификация `notifications/initialized`,
 *   дальше — `Mcp-Session-Id` и `MCP-Protocol-Version` на каждом запросе;
 * - 404 с выданной сессией = сессия истекла: один повторный `initialize`;
 * - ошибка JSON-RPC (`error`) — сбой протокола; `result.isError === true` —
 *   ошибка самого инструмента (их не смешиваем: ретрай уместен только у первой).
 *
 * GET-поток серверных уведомлений не открываем: ассистенту нужен только
 * запрос-ответ (Exa на GET отвечает 405 — это штатно).
 */

/** Класс сбоя: транспорт/протокол (повтор осмыслен) или ошибка инструмента. */
export class McpError extends Error {
  constructor(
    message: string,
    readonly kind: 'transport' | 'protocol' | 'tool',
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/** Сведения о сервере из handshake (показываются в настройках). */
export interface McpServerInfo {
  name: string | null;
  version: string | null;
  protocolVersion: string | null;
}

/** Инструмент сервера: имя, описание и JSON Schema аргументов. */
export interface McpToolDescriptor {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
}

/** Итог вызова инструмента: текст для модели + признак ошибки инструмента. */
export interface McpToolResult {
  text: string;
  isError: boolean;
}

export interface McpClientOptions {
  /** Endpoint сервера (`https://mcp.exa.ai/mcp`). */
  url: string;
  /** Ключ сервера; уходит заголовком `x-api-key` и никогда не логируется. */
  apiKey: string | null;
  /** Потолок одного запроса (по умолчанию 20 с). */
  timeoutMs?: number;
  /** Заголовки клиента в handshake (для диагностики на стороне сервера). */
  clientName?: string;
  clientVersion?: string;
}

/** Разбираемая версия протокола, которую умеет этот клиент. */
const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 20_000;

interface RpcMessage {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class McpClient {
  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;
  private nextId = 1;
  private readonly timeoutMs: number;

  constructor(private readonly options: McpClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Handshake: `initialize` + `notifications/initialized`. */
  async initialize(): Promise<McpServerInfo> {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: this.options.clientName ?? 'nodus',
          version: this.options.clientVersion ?? '1.0.0',
        },
      },
    });
    const result = asRecord(response.message.result);
    const server = asRecord(result?.serverInfo);
    this.protocolVersion = str(result?.protocolVersion) ?? PROTOCOL_VERSION;
    this.sessionId = response.sessionId ?? this.sessionId;

    // Нотификация обязательна: без неё часть серверов не переходит в
    // рабочую фазу и отвергает последующие запросы.
    await this.notify('notifications/initialized');

    return {
      name: str(server?.name),
      version: str(server?.version),
      protocolVersion: this.protocolVersion,
    };
  }

  /** Список инструментов сервера (с пагинацией по `nextCursor`). */
  async listTools(): Promise<McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = [];
    let cursor: string | null = null;
    do {
      const response = await this.request('tools/list', cursor ? { cursor } : {});
      const result = asRecord(response);
      const list = Array.isArray(result?.tools) ? result.tools : [];
      for (const raw of list) {
        const tool = asRecord(raw);
        const name = str(tool?.name);
        if (!name) continue;
        tools.push({
          name,
          description: str(tool?.description),
          inputSchema: asRecord(tool?.inputSchema),
        });
      }
      cursor = str(result?.nextCursor);
    } while (cursor);
    return tools;
  }

  /** Вызов инструмента: текст в ответ и признак ошибки инструмента. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const response = await this.request('tools/call', { name, arguments: args });
    const result = asRecord(response);
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content
      .map((item) => {
        const block = asRecord(item);
        return block?.type === 'text' ? (str(block.text) ?? '') : '';
      })
      .filter(Boolean)
      .join('\n');
    return { text, isError: result?.isError === true };
  }

  /** JSON-RPC уведомление: ответ 202 с пустым телом, результата нет. */
  private async notify(method: string): Promise<void> {
    await this.post({ jsonrpc: '2.0', method });
  }

  /** Запрос с результатом; сбой протокола — `McpError('protocol')`. */
  private async request(method: string, params: unknown): Promise<unknown> {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    });
    this.sessionId = response.sessionId ?? this.sessionId;
    const error = response.message.error;
    if (error) {
      throw new McpError(
        error.message ?? `Ошибка протокола MCP (${String(error.code ?? 'unknown')})`,
        'protocol',
        error.code !== undefined ? String(error.code) : null,
      );
    }
    return response.message.result;
  }

  /** Один POST: JSON или SSE; 404 с сессией — один новый handshake. */
  private async post(
    body: Record<string, unknown>,
    retried = false,
  ): Promise<{
    message: RpcMessage;
    sessionId: string | null;
  }> {
    const isNotification = body.id === undefined;
    const response = await this.fetchWithTimeout(body);
    const sessionId = response.headers.get('mcp-session-id');

    if (response.status === 404 && this.sessionId && !retried) {
      // Сессия истекла на сервере: начинаем заново ровно один раз.
      this.sessionId = null;
      await this.initialize();
      return this.post(body, true);
    }
    if (response.status === 202 || response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return { message: {}, sessionId };
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new McpError(
        `Сервер MCP ответил ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        'transport',
        String(response.status),
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      const expectedId = isNotification ? null : (body.id as number);
      return { message: await this.readSse(response, expectedId), sessionId };
    }
    const parsed = (await response.json().catch(() => null)) as RpcMessage | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new McpError('Сервер MCP вернул некорректный ответ', 'transport');
    }
    return { message: parsed, sessionId };
  }

  private async fetchWithTimeout(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Обязательная пара: без text/event-stream многие серверы отвечают 406.
      accept: 'application/json, text/event-stream',
    };
    if (this.options.apiKey) headers['x-api-key'] = this.options.apiKey;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    // Согласованная версия протокола — на всех запросах (спека 2025-06-18).
    headers['mcp-protocol-version'] = this.protocolVersion;
    try {
      return await fetch(this.options.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new McpError(
        timedOut ? 'Сервер MCP не ответил вовремя' : 'Не удалось соединиться с сервером MCP',
        'transport',
        timedOut ? 'timeout' : 'network',
      );
    }
  }

  /**
   * Чтение SSE до кадра с нашим `id`: сервер вправе держать поток открытым
   * (progress-уведомления), а `res.text()` здесь повис бы до закрытия.
   */
  private async readSse(response: Response, expectedId: number | null): Promise<RpcMessage> {
    if (!response.body) throw new McpError('Пустой поток SSE', 'transport');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        // stream: true — иначе рвутся многобайтные символы (кириллица).
        buffer += decoder.decode(value, { stream: true });
        let boundary = frameBoundary(buffer);
        while (boundary) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          const message = parseFrame(frame);
          if (message && (expectedId === null || message.id === expectedId)) {
            return message;
          }
          boundary = frameBoundary(buffer);
        }
      }
      buffer += decoder.decode();
      const tail = buffer.trim() ? parseFrame(buffer) : null;
      if (tail && (expectedId === null || tail.id === expectedId)) return tail;
      throw new McpError('Поток SSE закрылся без ответа', 'transport');
    } catch (error) {
      if (error instanceof McpError) throw error;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new McpError(
        timedOut ? 'Сервер MCP не ответил вовремя' : 'Обрыв потока MCP',
        'transport',
        timedOut ? 'timeout' : 'stream',
      );
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}

/** Конец SSE-кадра: пустая строка (LF или CRLF). */
function frameBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

/** Кадр SSE → JSON-RPC сообщение; комментарии/битые кадры пропускаются. */
function parseFrame(frame: string): RpcMessage | null {
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
