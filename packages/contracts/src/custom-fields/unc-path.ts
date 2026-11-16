/**
 * Грамматика UNC-пути значения «Ссылка или путь» (#558, ADR-0029 Р11) —
 * ОДНА для сохранения значения (API/веб), настроек файловых серверов и
 * моков. Исполнение пути проверяет оболочка отдельно (Rust), но store-
 * граница не должна принимать `..`, NUL и имена устройств.
 */
const MAX_PATH_LENGTH = 2000;

/** Запрещённые в имени сегмента пути символы Windows. */
const INVALID_SEGMENT = /[<>:"|?*\\]/;
/** Управляющие символы и NUL — в путях недопустимы. */
const CONTROL = /\p{Cc}/u;
/** Имена устройств DOS: `CON`, `NUL`, `COM1`… даже с расширением (`CON.txt`). */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Имя сервера: DNS-метка/IP-фрагмент, без пробелов и обратных слэшей. */
const SERVER_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/i;
/** Имя общей папки: пробелы допустимы, служебные символы — нет. */
const SHARE_NAME = /^[^\\/:*?"<>|\p{Cc}]+$/u;

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

/** Валидация имени сервера — одна на путь и allowlist. */
export function validUncServer(value: string): boolean {
  return validServer(value);
}

/** Валидация имени общей папки — одна на путь и allowlist. */
export function validUncShare(value: string): boolean {
  return validShare(value);
}

/** Разобранный UNC-путь значения «Ссылка или путь». */
export interface UncPathParts {
  server: string;
  share: string;
  /** Строка для открытия: без хвостовых разделителей. */
  path: string;
}

/**
 * Строгая проверка UNC-пути: `\\server\share[\…]` без `..`, NUL,
 * управляющих символов, имён устройств и хвостовых точек/пробелов.
 * Пространство имён устройства (`\\?\`, `\\.\`) запрещено.
 */
export function parseUncPath(raw: unknown): UncPathParts | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) return null;
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
  'sct',
  'shs',
  'msi',
  'msp',
  'ps1',
  'psm1',
  'ps1xml',
  'psc1',
  'pssc',
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
  'py',
  'pyw',
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
  'xll',
  'vsto',
  'chm',
  'msh',
  'mshxml',
  'xbap',
  'dotm',
  'docm',
  'xlsm',
  'xltm',
  'pptm',
  'potm',
  'ppsm',
  'sldm',
  'xlsb',
  'xlam',
  'xla',
  'ppam',
  'wll',
  'wbk',
  'accdb',
  'accde',
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
  if (dot < 0 || dot === name.length - 1) return false;
  const extension = name.slice(dot + 1).toLowerCase();
  return (REVEAL_ONLY_EXTENSIONS as readonly string[]).includes(extension);
}
