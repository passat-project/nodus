import { describe, expect, it } from 'vitest';

import {
  fileServersBodySchema,
  fileServerSchema,
  isPathOnFileServer,
  isRevealOnlyUncPath,
  normalizeFileServer,
  parseFileServer,
  parseUncPath,
} from './file-servers.schema.js';

/**
 * Файловые серверы и UNC-пути (#558, ADR-0029 Р11): allowlist — только
 * `\\server\share`; путь с `..`, NUL, управляющими символами, именем
 * устройства и хвостовой точкой не открывается; исполняемые типы — только
 * «Показать в папке».
 */

describe('файловый сервер (allowlist)', () => {
  it('принимает сервер и общую папку, нормализует регистр и хвостовой слэш', () => {
    expect(parseFileServer('\\\\FS01\\Projects')).toEqual({ server: 'FS01', share: 'Projects' });
    expect(normalizeFileServer('  \\\\FS01\\Projects\\  ')).toBe('\\\\FS01\\Projects');
    expect(parseFileServer('\\\\files.company.local\\Общая папка')).toEqual({
      server: 'files.company.local',
      share: 'Общая папка',
    });
    // Длина шары — в символах, не в байтах (45 символов / 85 байт UTF-8).
    expect(
      parseFileServer('\\\\FS01\\Общая папка отдела проектирования и изысканий'),
    ).not.toBeNull();
  });

  it('отвергает URL, локальные пути, сервер без папки и путь глубже папки', () => {
    for (const value of [
      'https://example.com',
      'C:\\Files',
      '\\\\server',
      '\\\\server\\share\\folder\\file.pdf',
      '\\\\server\\\\share',
      '',
    ]) {
      expect(parseFileServer(value), value).toBeNull();
    }
  });

  it('отвергает управляющие символы и недопустимые имена', () => {
    expect(parseFileServer('\\\\serv\u0001er\\share')).toBeNull();
    expect(parseFileServer('\\\\server\\sha*re')).toBeNull();
    expect(parseFileServer('\\\\server\\share.')).toBeNull();
    expect(parseFileServer('\\\\server\\ ')).toBeNull();
  });

  it('схема значения и тела PUT: дубли без учёта регистра отклоняются', () => {
    expect(fileServerSchema.parse('\\\\FS01\\Projects')).toBe('\\\\FS01\\Projects');
    expect(
      fileServersBodySchema.safeParse({
        servers: ['\\\\FS01\\Projects', '\\\\fs01\\projects'],
      }).success,
    ).toBe(false);
    expect(
      fileServersBodySchema.safeParse({ servers: ['\\\\FS01\\Projects', '\\\\FS02\\Docs'] })
        .success,
    ).toBe(true);
  });
});

describe('UNC-путь значения', () => {
  const servers = ['\\\\FS01\\Projects'];

  it('обычный файл разрешённой папки', () => {
    const path = '\\\\FS01\\Projects\\Дом 12\\Планы\\план.pdf';
    expect(parseUncPath(path)).toEqual({
      server: 'FS01',
      share: 'Projects',
      path,
    });
    expect(isPathOnFileServer(path, servers)).toBe(true);
    expect(isPathOnFileServer(`${path} `, servers)).toBe(false);
    // Хвостовой разделитель — папка: путь нормализуется без него.
    expect(parseUncPath('\\\\FS01\\Projects\\Дом 12\\')?.path).toBe('\\\\FS01\\Projects\\Дом 12');
  });

  it('чужой сервер, другая папка и URL не открываются', () => {
    expect(isPathOnFileServer('\\\\FS02\\Projects\\план.pdf', servers)).toBe(false);
    expect(isPathOnFileServer('\\\\FS01\\Docs\\план.pdf', servers)).toBe(false);
    expect(isPathOnFileServer('https://example.com/план.pdf', servers)).toBe(false);
  });

  it('обход через .., NUL, устройство и пространство имён запрещён', () => {
    for (const path of [
      '\\\\FS01\\Projects\\..\\Secret\\план.pdf',
      '\\\\FS01\\Projects\\.\\.hidden.pdf',
      '\\\\FS01\\Projects\\план\u0000.pdf',
      '\\\\FS01\\Projects\\CON.txt',
      '\\\\FS01\\Projects\\COM1\\план.pdf',
      '\\\\FS01\\Projects\\план.pdf ',
      '\\\\FS01\\Projects\\план.pdf.',
      '\\\\?\\UNC\\FS01\\Projects\\план.pdf',
      '\\\\.\\FS01\\Projects\\план.pdf',
      '//FS01/Projects/план.pdf',
    ]) {
      expect(parseUncPath(path), path).toBeNull();
      expect(isPathOnFileServer(path, servers), path).toBe(false);
    }
  });

  it('исполняемые файлы и ярлыки — только «Показать в папке»', () => {
    for (const name of [
      'setup.exe',
      'run.BAT',
      'script.ps1',
      'link.lnk',
      'site.url',
      'installer.msi',
      'shortcut.scr',
      'macro.vbs',
      'help.chm',
      'book.xlsm',
      'script.py',
    ]) {
      expect(isRevealOnlyUncPath(`\\\\FS01\\Projects\\${name}`), name).toBe(true);
    }
    for (const name of ['план.pdf', 'смета.xlsx', 'письмо.docx', 'архив.zip', 'без-точки']) {
      expect(isRevealOnlyUncPath(`\\\\FS01\\Projects\\${name}`), name).toBe(false);
    }
  });
});
