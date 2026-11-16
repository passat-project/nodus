import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  fileServersBodySchema,
  fileServerSchema,
  normalizeFileServer,
  parseFileServer,
  fileServerKey,
  type FileServersResponse,
} from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { PortalSettingsRepository } from './portal-settings.repository.js';

/** Ключ настройки «Файловые серверы» (#558): `\\server\share` без хвоста. */
export const FILE_SERVERS_KEY = 'desktop.fileServers';

/** «Никогда не сохранялись»: стабильная метка для клиента. */
const NEVER_UPDATED = new Date(0).toISOString();

/**
 * Настройки портала (#558, эпик #869): первая жилица — список файловых
 * серверов, чьи папки десктоп-оболочка может открывать. Читают все
 * аутентифицированные (список нужен вебу, чтобы показать действия у пути);
 * меняет только право `portal.settings.manage` (гвард контроллера, I8).
 *
 * Битые/устаревшие данные в БД не роняют страницу: при чтении значения
 * проходят грамматику и молча отбрасываются (настройка сброшена в пустую).
 */
@Injectable()
export class PortalSettingsService {
  constructor(private readonly repo: PortalSettingsRepository) {}

  async getFileServers(): Promise<FileServersResponse> {
    const row = await this.repo.get(FILE_SERVERS_KEY);
    if (!row) return { servers: [], updatedAt: NEVER_UPDATED };
    return {
      servers: readServers(row.value),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async putFileServers(servers: readonly string[]): Promise<FileServersResponse> {
    // Граница сервера строгая: мусор — 400 с причиной, а не тихая запись.
    const parsed = fileServersBodySchema.safeParse({ servers });
    if (!parsed.success) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid file servers', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const normalized = parsed.data.servers.map((server) => normalizeFileServer(server)!);
    const row = await this.repo.put(FILE_SERVERS_KEY, { servers: normalized });
    return {
      servers: readServers(row.value),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Толерантное чтение: только валидные `\\server\share`, без дублей. */
function readServers(value: unknown): string[] {
  const raw =
    value && typeof value === 'object' && 'servers' in value
      ? (value as { servers?: unknown }).servers
      : undefined;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const servers: string[] = [];
  for (const item of raw) {
    const parsed = fileServerSchema.safeParse(item);
    if (!parsed.success) continue;
    const server = parseFileServer(parsed.data);
    if (!server) continue;
    const key = fileServerKey(server.server, server.share);
    if (seen.has(key)) continue;
    seen.add(key);
    servers.push(normalizeFileServer(parsed.data)!);
  }
  return servers;
}
