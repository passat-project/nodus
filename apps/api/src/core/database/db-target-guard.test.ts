import { describe, expect, it } from 'vitest';

import { assertSafeDbTarget, databaseName, isMutatingPrismaCommand } from './db-target-guard.js';

/**
 * Инцидент 18.11.2026: `prisma db execute` с хоста применил аддитивную
 * миграцию к прод-БД `nodus`. Предохранитель блокирует интерактивные и
 * ad-hoc команды на проде, но не трогает штатный `migrate deploy`.
 */

const PROD = 'postgresql://nodus:secret@127.0.0.1:5432/nodus';
const NIGHT = 'postgresql://nodus:secret@127.0.0.1:5432/nodus_night';

describe('предохранитель цели БД', () => {
  it('имя БД из URL и мусор', () => {
    expect(databaseName(PROD)).toBe('nodus');
    expect(databaseName(NIGHT)).toBe('nodus_night');
    expect(databaseName('не-url')).toBeNull();
    expect(databaseName('postgresql://h:5432/')).toBeNull();
  });

  it('опасные команды распознаются, deploy/status — нет', () => {
    expect(isMutatingPrismaCommand(['db', 'execute', '--file', 'x.sql'])).toBe(true);
    expect(isMutatingPrismaCommand(['migrate', 'dev', '--name', 'x'])).toBe(true);
    expect(isMutatingPrismaCommand(['migrate', 'reset'])).toBe(true);
    expect(isMutatingPrismaCommand(['db', 'push'])).toBe(true);
    expect(isMutatingPrismaCommand(['migrate', 'deploy'])).toBe(false);
    expect(isMutatingPrismaCommand(['migrate', 'status'])).toBe(false);
    expect(isMutatingPrismaCommand(['generate'])).toBe(false);
    expect(isMutatingPrismaCommand(['migrate', 'diff'])).toBe(false);
  });

  it('прод-БД + опасная команда — блок; обход и песочница — пропуск', () => {
    expect(assertSafeDbTarget({ url: PROD, argv: ['db', 'execute'], env: {} })).toContain(
      'ПРОД-БД',
    );
    expect(assertSafeDbTarget({ url: PROD, argv: ['migrate', 'dev'], env: {} })).toContain('STOP');
    expect(assertSafeDbTarget({ url: PROD, argv: ['migrate', 'deploy'], env: {} })).toBeNull();
    expect(assertSafeDbTarget({ url: PROD, argv: ['generate'], env: {} })).toBeNull();
    expect(
      assertSafeDbTarget({ url: PROD, argv: ['db', 'execute'], env: { ALLOW_PROD_DB: '1' } }),
    ).toBeNull();
    expect(assertSafeDbTarget({ url: NIGHT, argv: ['db', 'execute'], env: {} })).toBeNull();
  });
});
