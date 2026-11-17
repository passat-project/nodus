import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import type { AssistantMcpBody } from '@nodus/contracts';

import type { SecretBoxService } from '../../../core/crypto/secret-box.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type { McpSettingsRepository, McpServerRow } from './mcp-settings.repository.js';
import { McpSettingsService } from './mcp-settings.service.js';

/**
 * Реестр MCP-серверов (#902): ключ пишется только при передаче (иначе
 * сохраняется прежний), «по умолчанию для поиска» — ровно один сервер,
 * чужая/несуществующая запись даёт понятную ошибку, а не 500.
 */

const stored: McpServerRow = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Exa',
  url: 'https://mcp.exa.ai/mcp',
  transport: 'streamable-http',
  apiKeyCiphertext: 'cipher',
  apiKeyHint: 'abcd',
  enabled: true,
  defaultForSearch: true,
  sortOrder: 0,
};

function body(patch: Partial<AssistantMcpBody['servers'][number]> = {}): AssistantMcpBody {
  return {
    servers: [
      {
        id: stored.id,
        name: stored.name,
        url: stored.url,
        transport: 'streamable-http',
        enabled: true,
        defaultForSearch: false,
        ...patch,
      },
    ],
  };
}

function makeService(rows: McpServerRow[] = [{ ...stored }]) {
  const repo = {
    findServers: vi.fn(async () => rows.map((row) => ({ ...row }))),
    findServer: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
    replaceAll: vi.fn(async () => undefined),
  } as unknown as McpSettingsRepository;
  const secretBox = {
    seal: (value: string) => `sealed:${value}`,
    hint: (value: string) => value.slice(-4),
    open: () => 'exa-key',
  } as unknown as SecretBoxService;
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return { service: new McpSettingsService(repo, secretBox, logger), repo };
}

describe('McpSettingsService.put', () => {
  it('ключ не передан — сохраняется прежний шифртекст; наружу только hasKey/keyHint', async () => {
    const { service, repo } = makeService();
    const result = await service.put(body({ name: 'Exa MCP' }));
    const saved = (repo.replaceAll as unknown as { mock: { calls: [unknown[][]] } }).mock
      .calls[0]?.[0] as { apiKeyCiphertext: string | null; name: string }[];
    expect(saved[0]?.apiKeyCiphertext).toBe('cipher');
    expect(saved[0]?.name).toBe('Exa MCP');
    expect(result.servers[0]).toMatchObject({ hasKey: true, keyHint: 'abcd' });
    expect(JSON.stringify(result)).not.toContain('cipher');
  });

  it('новый ключ шифруется, clearKey удаляет', async () => {
    const first = makeService();
    await first.service.put(body({ apiKey: 'exa-new-key' }));
    const saved = (first.repo.replaceAll as unknown as { mock: { calls: [unknown[][]] } }).mock
      .calls[0]?.[0] as { apiKeyCiphertext: string | null; apiKeyHint: string | null }[];
    expect(saved[0]).toMatchObject({ apiKeyCiphertext: 'sealed:exa-new-key', apiKeyHint: '-key' });

    const second = makeService();
    await second.service.put(body({ clearKey: true }));
    const cleared = (second.repo.replaceAll as unknown as { mock: { calls: [unknown[][]] } }).mock
      .calls[0]?.[0] as { apiKeyCiphertext: string | null }[];
    expect(cleared[0]?.apiKeyCiphertext).toBeNull();
  });

  it('два сервера «по умолчанию для поиска» — ошибка валидации, запись не идёт', async () => {
    const { service, repo } = makeService();
    await expect(
      service.put({
        servers: [
          {
            name: 'A',
            url: 'https://a.example/mcp',
            transport: 'streamable-http',
            enabled: true,
            defaultForSearch: true,
          },
          {
            name: 'B',
            url: 'https://b.example/mcp',
            transport: 'streamable-http',
            enabled: true,
            defaultForSearch: true,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(DomainException);
    expect(repo.replaceAll).not.toHaveBeenCalled();
  });

  it('нельзя одновременно задать и удалить ключ', async () => {
    const { service } = makeService();
    await expect(
      service.put(body({ apiKey: 'exa-new-key', clearKey: true })),
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('адрес нормализуется (без хвостового слэша)', async () => {
    const { service, repo } = makeService();
    await service.put(body({ url: 'https://mcp.exa.ai/mcp/' }));
    const saved = (repo.replaceAll as unknown as { mock: { calls: [unknown[][]] } }).mock
      .calls[0]?.[0] as { url: string }[];
    expect(saved[0]?.url).toBe('https://mcp.exa.ai/mcp');
  });
});

describe('McpSettingsService.test', () => {
  it('неизвестный сервер — доменная 404-ошибка', async () => {
    const { service } = makeService();
    await expect(service.test('33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
      DomainException,
    );
  });

  it('сбой сервера возвращается данными (ok:false), а не исключением', async () => {
    const { service } = makeService();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 502 })),
    );
    const result = await service.test(stored.id);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('mcp_unavailable');
    expect(result.tools).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('McpSettingsService.resolveForSearch', () => {
  it('берёт сервер «по умолчанию», иначе первый включённый; выключенные пропускает', async () => {
    const disabled = { ...stored, id: '44444444-4444-4444-8444-444444444444', enabled: false };
    const first = { ...stored, defaultForSearch: false };
    const resolved = await makeService([disabled, first]).service.resolveForSearch();
    expect(resolved?.row.id).toBe(first.id);

    const empty = await makeService([]).service.resolveForSearch();
    expect(empty).toBeNull();
  });
});
