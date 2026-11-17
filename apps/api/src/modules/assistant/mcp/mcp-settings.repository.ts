import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service.js';

/**
 * Доступ модуля assistant к реестру внешних MCP-серверов (#902, ADR-0043
 * п. 10): отдельная таблица, потому что это самостоятельная сущность
 * настроек (адрес, транспорт, ключ, включённость), а не поле провайдера
 * моделей. Все включённые серверы равнозначны (решение 18.11.2026).
 *
 * Секреты: `apiKeyCiphertext` — шифртекст (`core/crypto`); репозиторий его
 * не расшифровывает — это делает сервис на время вызова сервера.
 */

/** Строка сервера как она лежит в БД. */
export interface McpServerRow {
  id: string;
  name: string;
  url: string;
  transport: string;
  apiKeyCiphertext: string | null;
  apiKeyHint: string | null;
  enabled: boolean;
  sortOrder: number;
}

/** Сервер на запись: шифртекст уже посчитан сервисом. */
export interface McpServerWrite {
  id: string;
  name: string;
  url: string;
  transport: string;
  apiKeyCiphertext: string | null;
  apiKeyHint: string | null;
  enabled: boolean;
  sortOrder: number;
}

@Injectable()
export class McpSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findServers(): Promise<McpServerRow[]> {
    return this.prisma.assistantMcpServer.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findServer(id: string): Promise<McpServerRow | null> {
    return this.prisma.assistantMcpServer.findUnique({ where: { id } });
  }

  /**
   * Полная замена списка в одной транзакции: серверы вне списка удаляются
   * (история прогонов ссылается только на снимок имени инструмента).
   */
  async replaceAll(servers: McpServerWrite[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.assistantMcpServer.deleteMany({
        where: { id: { notIn: servers.map((server) => server.id) } },
      });
      for (const server of servers) {
        const common = {
          name: server.name,
          url: server.url,
          transport: server.transport,
          apiKeyCiphertext: server.apiKeyCiphertext,
          apiKeyHint: server.apiKeyHint,
          enabled: server.enabled,
          sortOrder: server.sortOrder,
        };
        await tx.assistantMcpServer.upsert({
          where: { id: server.id },
          create: { id: server.id, ...common },
          update: common,
        });
      }
    });
  }
}
