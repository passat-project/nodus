import { z } from 'zod';

import { CUSTOM_FIELD_LIMITS } from '../custom-fields/custom-field-values.js';

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

/** Запрещённые в имени сегмента пути символы Windows. */
const INVALID_SEGMENT = /[<>:"|?*\\/]/;
/** Управляющие символы и NUL — в путях недопустимы. */
const CONTROL = /\p{Cc}/u;
/** Имена устройств DOS: `CON`, `NUL`, `COM1`… даже с расширением (`CON.txt`). */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Имя сервера: DNS-метка/IP-фрагмент, без пробелов и обратных слэшей. */
const SERVER_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/i;
/** Имя общей папки: пробелы допустимы, служебные символы — нет. */
const SHARE_NAME = /^[^\\/:*?"<>|\p{Cc}]+$/u;

export interface FileServer {
  server: string;
  share: string;
}

function validServer(value: string): boolean {
  return value.length > 0 && value.length <= 253 && SERVER_NAME.test(value);
}

function validShare(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 80 &&
    value !== '.' &&
    value !== '..' &&
    !value.endsWith('.') &&
    !value.endsWith(' ') &&
    SHARE_NAME.test(value)
  );
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
  if (!validServer(server) || !validShare(share)) return null;
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

/** Разобранный UNC-путь значения «Ссылка или путь». */
export interface UncPathParts {
  server: string;
  share: string;
  /** Исходная строка без изменений (открывается ровно она). */
  path: string;
}

/**
 * Строгая проверка UNC-пути файла: `\\server\share[\…]` без `..`, NUL,
 * управляющих символов, имён устройств и хвостовых точек/пробелов.
 * Пространство имён устройства (`\\?\`, `\\.\`) запрещено.
 */
export function parseUncPath(raw: unknown): UncPathParts | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > CUSTOM_FIELD_LIMITS.link) return null;
  if (raw.trim() !== raw) return null;
  if (!raw.startsWith('\\\\') || raw.startsWith('\\\\?\\') || raw.startsWith('\\\\.\\')) {
    return null;
  }
  if (CONTROL.test(raw)) return null;
  // Хвостовой разделитель — законная запись папки; открываем без него.
  const path = raw.replace(/\\+$/, '');
  if (!path.startsWith('\\\\') || path.length <= 2) return null;
  const segments = path.slice(2).split('\\');
  if (segments.length < 2) return null;
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') return null;
    if (INVALID_SEGMENT.test(segment)) return null;
    if (segment.endsWith('.') || segment.endsWith(' ')) return null;
    const base = segment.split('.')[0] ?? '';
    if (DEVICE_NAME.test(base)) return null;
  }
  const [server, share] = segments as [string, string];
  if (!validServer(server) || !validShare(share)) return null;
  return { server, share, path };
}

/** Путь принадлежит одной из разрешённых серверных папок. */
export function isPathOnFileServer(raw: unknown, servers: readonly string[]): boolean {
  const path = parseUncPath(raw);
  if (!path) return false;
  const key = fileServerKey(path.server, path.share);
  return servers.some((value) => {
    const parsed = parseFileServer(value);
    return parsed !== null && fileServerKey(parsed.server, parsed.share) === key;
  });
}

/**
 * Расширения, которые нельзя ЗАПУСКАТЬ из значения-пути: исполняемые файлы,
 * скрипты, установщики и ярлыки. Для них доступно только «Показать в папке».
 * Список — политика оболочки; Rust-сторона проверяет его независимо.
 */
export const REVEAL_ONLY_EXTENSIONS = [
  'exe',
  'com',
  'bat',
  'cmd',
  'pif',
  'scr',
  'msi',
  'msp',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'hta',
  'cpl',
  'lnk',
  'url',
  'reg',
  'inf',
  'scf',
  'msc',
  'jar',
  'application',
  'appref-ms',
  'appx',
  'appxbundle',
  'msix',
  'msixbundle',
  'gadget',
  'dll',
  'ocx',
  'sys',
  'drv',
  'iso',
  'img',
  'vhd',
  'vhdx',
  'diagcab',
  'settingcontent-ms',
  'search-ms',
  'website',
  'library-ms',
] as const;

/** Файл такого типа разрешено только показать в папке (не запускать). */
export function isRevealOnlyUncPath(raw: unknown): boolean {
  const path = parseUncPath(raw);
  if (!path) return true;
  const segments = path.path.split('\\');
  const name = segments[segments.length - 1] ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return false;
  const extension = name.slice(dot + 1).toLowerCase();
  return (REVEAL_ONLY_EXTENSIONS as readonly string[]).includes(extension);
}
