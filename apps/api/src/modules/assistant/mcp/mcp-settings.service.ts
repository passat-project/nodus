import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  ErrorCode,
  type AssistantMcpBody,
  type AssistantMcpResponse,
  type AssistantMcpServer,
  type AssistantMcpTestResponse,
} from '@nodus/contracts';

import { SecretBoxService } from '../../../core/crypto/secret-box.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { McpClient, McpError } from './mcp-client.js';
import { McpSettingsRepository, type McpServerRow } from './mcp-settings.repository.js';

/** Таймаут проверки соединения: администратор ждёт ответа на экране. */
const TEST_TIMEOUT_MS = 20_000;
/** Потолок инструментов в ответе проверки: доказательство «живой», не дамп. */
const TEST_TOOLS_LIMIT = 50;

/**
 * Реестр внешних MCP-серверов (#902, ADR-0043 п. 10): чтение/запись настроек,
 * проверка соединения и выбор сервера для поиска (Ф3, #901).
 *
 * Ключи: на запись — шифрование `SecretBoxService`; на чтение — только
 * `hasKey` и хвост. Расшифрованный ключ живёт в памяти вызова клиента и не
 * попадает ни в БД, ни в ответы, ни в логи.
 */
@Injectable()
export class McpSettingsService {
  constructor(
    private readonly repo: McpSettingsRepository,
    private readonly secretBox: SecretBoxService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(McpSettingsService.name);
  }

  async get(): Promise<AssistantMcpResponse> {
    const servers = await this.repo.findServers();
    return { servers: servers.map((row) => this.toDto(row)) };
  }

  /**
   * Полная замена списка серверов одним `PUT` (идемпотентно). Ключ пишется
   * только если передан (`apiKey`); `clearKey` удаляет; иначе сохраняется
   * прежний — форма не может «стереть» ключ, не зная его.
   */
  async put(body: AssistantMcpBody): Promise<AssistantMcpResponse> {
    const existing = new Map((await this.repo.findServers()).map((row) => [row.id, row]));
    const servers = body.servers.map((input, index) => {
      const current = input.id ? existing.get(input.id) : undefined;
      if (input.apiKey && input.clearKey) {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Нельзя одновременно задать и удалить ключ',
          { field: 'apiKey' },
        );
      }
      // Сохранённый ключ не уходит на другой хост: смена origin адреса
      // (опечатка, подменённый URL) требует ввести ключ заново — иначе
      // секрет отправился бы новому владельцу адреса (ADR-0044 п. 4 —
      // та же защита, что у провайдеров моделей).
      if (
        current?.apiKeyCiphertext &&
        !input.apiKey &&
        !input.clearKey &&
        originOf(input.url) !== originOf(current.url)
      ) {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Адрес сервера изменился — введите ключ заново (или удалите его)',
          { field: 'apiKey' },
        );
      }
      let ciphertext = current?.apiKeyCiphertext ?? null;
      let hint = current?.apiKeyHint ?? null;
      if (input.apiKey) {
        ciphertext = this.secretBox.seal(input.apiKey);
        hint = this.secretBox.hint(input.apiKey);
      } else if (input.clearKey) {
        ciphertext = null;
        hint = null;
      }
      return {
        id: input.id ?? randomUUID(),
        name: input.name,
        url: input.url.replace(/\/+$/, ''),
        transport: input.transport,
        apiKeyCiphertext: ciphertext,
        apiKeyHint: hint,
        enabled: input.enabled,
        sortOrder: index,
      };
    });

    await this.repo.replaceAll(servers);
    return this.get();
  }

  /**
   * Проверка соединения: `initialize` + `tools/list`. Результат — данными
   * (`ok: false` с причиной), а не HTTP-ошибкой: экран настроек показывает
   * состояние без «красного» сбоя всей формы (как у провайдеров).
   */
  async test(id: string): Promise<AssistantMcpTestResponse> {
    const row = await this.requireServer(id);
    const started = Date.now();
    try {
      const client = this.clientForRow(row);
      const info = await client.initialize();
      const tools = await client.listTools();
      return {
        ok: true,
        latencyMs: Date.now() - started,
        serverName: info.name,
        protocolVersion: info.protocolVersion,
        tools: tools.slice(0, TEST_TOOLS_LIMIT).map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      const failure = this.failure(error);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        serverName: null,
        protocolVersion: null,
        tools: [],
        errorCode: failure.code,
        errorMessage: failure.message,
      };
    }
  }

  /**
   * ВСЕ включённые серверы (решение владельца 18.11.2026): MCP — не «поиск
   * по умолчанию», а равнозначный набор внешних инструментов. Агент получает
   * инструменты каждого сервера; недоступный сервер пропускается на этапе
   * `tools/list` и не валит прогон.
   */
  async resolveEnabled(): Promise<{ row: McpServerRow; client: McpClient }[]> {
    const rows = (await this.repo.findServers()).filter((row) => row.enabled);
    return rows.map((row) => ({ row, client: this.clientForRow(row) }));
  }

  private toDto(row: McpServerRow): AssistantMcpServer {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      transport: 'streamable-http',
      hasKey: Boolean(row.apiKeyCiphertext),
      keyHint: row.apiKeyHint,
      enabled: row.enabled,
    };
  }

  /** Клиент сервера с расшифрованным ключом (ключ живёт только здесь). */
  private clientForRow(row: McpServerRow): McpClient {
    const apiKey = row.apiKeyCiphertext ? this.secretBox.open(row.apiKeyCiphertext) : null;
    if (row.apiKeyCiphertext && apiKey === null) {
      // Ключ сохранён, но не расшифровывается (сменился материал шифрования):
      // предупреждаем в лог и идём без ключа — сервер ответит отказом, и
      // администратор увидит причину в «Проверить соединение», а не пустой 401.
      this.logger.warn({ serverId: row.id }, 'MCP api key cannot be decrypted');
    }
    return new McpClient({ url: row.url, apiKey, timeoutMs: TEST_TIMEOUT_MS });
  }

  private async requireServer(id: string): Promise<McpServerRow> {
    const row = await this.repo.findServer(id);
    if (!row) {
      throw new DomainException(ErrorCode.ASSISTANT_MCP_NOT_FOUND, 'MCP-сервер не найден');
    }
    return row;
  }

  /** Единый маппинг сбоев MCP: код для интерфейса + человеческий текст. */
  private failure(error: unknown): { code: string; message: string } {
    if (error instanceof McpError) {
      if (error.code === 'timeout') {
        return { code: 'mcp_timeout', message: 'Сервер MCP не ответил вовремя' };
      }
      return {
        code: error.kind === 'protocol' ? 'mcp_protocol_error' : 'mcp_unavailable',
        message: error.message,
      };
    }
    this.logger.warn({ err: error }, 'MCP request failed');
    return { code: 'mcp_unavailable', message: 'Сервер MCP не отвечает' };
  }
}

/** Origin адреса (`https://host:port`); невалидный URL — пустая строка. */
function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}
