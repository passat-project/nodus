import { describe, expect, it, vi } from 'vitest';

import { McpSettingsRepository } from './mcp-settings.repository.js';

/**
 * Репозиторий реестра MCP (#902): полная замена списка в транзакции —
 * удаление отсутствующих и upsert остальных (как у провайдеров).
 */

function makeRepo() {
  const tx = {
    assistantMcpServer: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
  };
  const prisma = {
    assistantMcpServer: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
  };
  return { repo: new McpSettingsRepository(prisma as never), tx, prisma };
}

const server = {
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

describe('McpSettingsRepository.replaceAll', () => {
  it('удаляет серверы вне списка и upsert-ит остальные в одной транзакции', async () => {
    const { repo, tx, prisma } = makeRepo();
    await repo.replaceAll([server]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.assistantMcpServer.deleteMany).toHaveBeenCalledWith({
      where: { id: { notIn: [server.id] } },
    });
    expect(tx.assistantMcpServer.upsert).toHaveBeenCalledWith({
      where: { id: server.id },
      create: expect.objectContaining({ id: server.id, name: 'Exa' }),
      update: expect.objectContaining({ name: 'Exa', defaultForSearch: true }),
    });
  });

  it('пустой список очищает реестр', async () => {
    const { repo, tx } = makeRepo();
    await repo.replaceAll([]);
    expect(tx.assistantMcpServer.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: [] } } });
    expect(tx.assistantMcpServer.upsert).not.toHaveBeenCalled();
  });
});

describe('McpSettingsRepository: чтение', () => {
  it('сортировка по sortOrder, затем по имени', async () => {
    const { repo, prisma } = makeRepo();
    await repo.findServers();
    expect(prisma.assistantMcpServer.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('findServer ищет по id и возвращает null, если нет', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.findServer('22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(prisma.assistantMcpServer.findUnique).toHaveBeenCalledWith({
      where: { id: '22222222-2222-4222-8222-222222222222' },
    });
  });
});
