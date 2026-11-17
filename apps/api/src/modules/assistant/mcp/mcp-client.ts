import { ASSISTANT_LIMITS } from '@nodus/contracts';

import { asRecord, str } from '../tools/projections.js';
import { assertAllowedEndpoint } from './mcp-endpoint-guard.js';

export { assertAllowedEndpoint, isPrivateAddress } from './mcp-endpoint-guard.js';
import { McpError } from './mcp-error.js';
import { frameBoundary, parseFrame, parseRpcMessage, type RpcMessage } from './mcp-rpc.js';

export { McpError };

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
/** Потолок тела одного ответа/кадра SSE: сервер не «раздувает» память API. */
const MAX_RESPONSE_BYTES = 1_000_000;
/** Потолок страниц `tools/list`: защита от бесконечного `nextCursor`. */
const MAX_TOOL_PAGES = 20;
/** Потолок инструментов одного сервера: каталог, а не дамп. */
const MAX_TOOLS = 200;
/** Потолок текстовых полей дескриптора: имя и описание — внешний ввод. */
const MAX_TOOL_NAME_CHARS = 200;
const MAX_TOOL_DESCRIPTION_CHARS = 1_000;

export class McpClient {
  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;
  private nextId = 1;
  private readonly timeoutMs: number;
  /** Идёт повторный handshake: второй 404 внутри него — обрыв, а не рекурсия. */
  private reinitializing = false;

  constructor(private readonly options: McpClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Handshake: `initialize` + `notifications/initialized`. */
  async initialize(): Promise<McpServerInfo> {
    // Через `request`, а не `post`: JSON-RPC ошибка handshake — исключение,
    // а не «успех с пустым protocolVersion» (находка теста 17.11.2026).
    const result = asRecord(
      await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: this.options.clientName ?? 'nodus',
          version: this.options.clientVersion ?? '1.0.0',
        },
      }),
    );
    const server = asRecord(result?.serverInfo);
    this.protocolVersion = str(result?.protocolVersion) ?? PROTOCOL_VERSION;

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
    let pages = 0;
    do {
      // Бесконечный `nextCursor` — сбой сервера, а не повод крутиться вечно.
      if (++pages > MAX_TOOL_PAGES) {
        throw new McpError(
          'Сервер MCP отдал слишком много страниц инструментов',
          'protocol',
          'too_many_pages',
        );
      }
      const response = await this.request('tools/list', cursor ? { cursor } : {});
      const result = asRecord(response);
      const list = Array.isArray(result?.tools) ? result.tools : [];
      for (const raw of list) {
        const tool = asRecord(raw);
        const name = str(tool?.name);
        if (!name) continue;
        tools.push({
          name: name.slice(0, MAX_TOOL_NAME_CHARS),
          // Каталог сервера — тоже внешний ввод: длинные описания не должны
          // раздувать ответ проверки и кэш идемпотентности (ревью 17.11.2026).
          description: str(tool?.description)?.slice(0, MAX_TOOL_DESCRIPTION_CHARS) ?? null,
          inputSchema: asRecord(tool?.inputSchema),
        });
        if (tools.length >= MAX_TOOLS) return tools;
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
    // Потолок до промпта: результат MCP-инструмента — тоже данные модели, а
    // не «сколько прислали» (ADR-0043: компактные проекции и лимит знаков).
    return {
      text: text.slice(0, ASSISTANT_LIMITS.maxToolResultChars),
      isError: result?.isError === true,
    };
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
      // Текст внешней ошибки не переносим: сервер может вернуть эхо наших же
      // заголовков (включая ключ), а ответ проверки кэшируется идемпотентностью
      // на 24 ч — секрет осел бы в Redis открытым текстом (ревью 17.11.2026).
      const code = error.code !== undefined ? String(error.code) : null;
      throw new McpError(`Ошибка протокола MCP${code ? ` (код ${code})` : ''}`, 'protocol', code);
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
      // Сессия истекла на сервере: начинаем заново ровно один раз. Повторный
      // 404 внутри самого handshake — тупик: рвём, а не рекурсируем (иначе
      // сервер, отвергающий нотификацию, вешает обработчик навсегда).
      if (this.reinitializing) {
        await response.body?.cancel().catch(() => undefined);
        throw new McpError('Сервер MCP не подтверждает сессию', 'transport', 'session');
      }
      await response.body?.cancel().catch(() => undefined);
      this.reinitializing = true;
      try {
        this.sessionId = null;
        await this.initialize();
      } finally {
        this.reinitializing = false;
      }
      return this.post(body, true);
    }
    if (response.status === 202 || response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return { message: {}, sessionId };
    }
    if (!response.ok) {
      // Тело внешнего ответа в текст ошибки не попадает (security #8): сервер
      // мог бы эхом вернуть ключ, а строка уходит в UI и кэш идемпотентности.
      await response.body?.cancel().catch(() => undefined);
      throw new McpError(
        `Сервер MCP ответил ${response.status}`,
        'transport',
        String(response.status),
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      const expectedId = isNotification ? null : (body.id as number);
      return { message: await this.readSse(response, expectedId), sessionId };
    }
    const raw = await this.readCapped(response);
    const parsed = parseRpcMessage(raw);
    if (!parsed) {
      throw new McpError('Сервер MCP вернул некорректный ответ', 'transport');
    }
    return { message: parsed, sessionId };
  }

  private async fetchWithTimeout(body: Record<string, unknown>): Promise<Response> {
    // Адрес настройки проверяется на каждом вызове: гвард дешёвый, а ключ
    // уходит именно на него (защита в глубину к схеме настроек).
    assertAllowedEndpoint(this.options.url);
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
        // Редирект запрещён: Node пересылает кастомные заголовки (x-api-key)
        // на новый адрес, а https→http понижение не блокирует — ключ утёк бы
        // чужому хосту (находка security-ревью 17.11.2026).
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
      throw new McpError(
        timedOut ? 'Сервер MCP не ответил вовремя' : 'Не удалось соединиться с сервером MCP',
        'transport',
        timedOut ? 'timeout' : 'network',
      );
    }
  }

  /** Тело ответа с потолком байт: гигантский ответ — сбой сервера, не память. */
  private async readCapped(response: Response): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          throw new McpError('Ответ MCP-сервера слишком большой', 'transport', 'too_large');
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
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
        if (buffer.length > MAX_RESPONSE_BYTES) {
          throw new McpError('Ответ MCP-сервера слишком большой', 'transport', 'too_large');
        }
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
      // Таймаут, сработавший во время чтения тела, приходит сюда как
      // AbortError/TimeoutError — это «не ответил», а не «оборвался поток».
      const name = error instanceof Error ? error.name : '';
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
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
