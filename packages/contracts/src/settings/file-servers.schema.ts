import { z } from 'zod';

import {
  parseUncPath as parsePath,
  validUncServer,
  validUncShare,
} from '../custom-fields/unc-path.js';

/**
 * Файловые серверы «Настроек портала» (#558, ADR-0029 Р11).
 *
 * Администратор задаёт список разрешённых серверов и общих папок
 * (`\\server\share`, без пути глубже — минимальные права). Десктоп-оболочка
 * открывает файлы только внутри этих папок; браузер путь по-прежнему лишь
 * копирует (браузеры не дают сайтам открывать сетевые файлы).
 *
 * Грамматика общая для веба, моков и сервера; Rust-сторона оболочки
 * повторяет проверку (она — последняя линия: команда моста принимает
 * произвольную строку от веб-контента).
 */

/** Лимиты списка: сколько серверов и знаков в одном значении. */
export const FILE_SERVER_LIMITS = {
  count: 50,
  length: 260,
} as const;

export interface FileServer {
  server: string;
  share: string;
}

/**
 * Разбор `\\server\share`: ровно сервер и общая папка, без хвоста пути.
 * `null` — не серверная папка (URL, локальный путь, `\\server` без папки).
 */
export function parseFileServer(raw: unknown): FileServer | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/\\+$/, '');
  if (!value.startsWith('\\\\')) return null;
  const parts = value.slice(2).split('\\');
  if (parts.length !== 2) return null;
  const [server, share] = parts as [string, string];
  if (!validUncServer(server) || !validUncShare(share)) return null;
  return { server, share };
}

/** Каноническая запись серверной папки (`\\server\share`) или `null`. */
export function normalizeFileServer(raw: unknown): string | null {
  const parsed = parseFileServer(raw);
  return parsed ? `\\\\${parsed.server}\\${parsed.share}` : null;
}

/** Ключ сравнения серверных папок: Windows не различает регистр. */
export function fileServerKey(server: string, share: string): string {
  return `${server.toLowerCase()}\\${share.toLowerCase()}`;
}

/** Схема одного сервера — trim, длина и грамматика `\\server\share`. */
export const fileServerSchema = z
  .string()
  .trim()
  .min(4)
  .max(FILE_SERVER_LIMITS.length)
  .refine((value) => parseFileServer(value) !== null, {
    message: 'file server must be \\\\server\\share',
  });

/** Тело PUT: полная замена списка, без дублей (регистр не важен). */
export const fileServersBodySchema = z
  .object({
    servers: z.array(fileServerSchema).max(FILE_SERVER_LIMITS.count),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.servers.forEach((value, index) => {
      const parsed = parseFileServer(value);
      if (!parsed) return;
      const key = fileServerKey(parsed.server, parsed.share);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['servers', index],
          message: 'duplicate file server',
        });
      }
      seen.add(key);
    });
  });

export type FileServersBody = z.infer<typeof fileServersBodySchema>;

/** Ответ GET/PUT: нормализованный список и метка последней записи. */
export const fileServersResponseSchema = z.object({
  servers: z.array(fileServerSchema),
  updatedAt: z.iso.datetime(),
});

export type FileServersResponse = z.infer<typeof fileServersResponseSchema>;

export {
  REVEAL_ONLY_EXTENSIONS,
  isRevealOnlyUncPath,
  parseUncPath,
  type UncPathParts,
} from '../custom-fields/unc-path.js';

/** Путь принадлежит одной из разрешённых серверных папок. */
export function isPathOnFileServer(raw: unknown, servers: readonly string[]): boolean {
  const path = parsePath(raw);
  if (!path) return false;
  const key = fileServerKey(path.server, path.share);
  return servers.some((value) => {
    const parsed = parseFileServer(value);
    return parsed !== null && fileServerKey(parsed.server, parsed.share) === key;
  });
}
