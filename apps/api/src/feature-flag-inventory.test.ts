import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Инвентаризация фичефлагов (I10, #866/AUD-017, #878): прод-образ выполняет
 * только `prisma migrate deploy` — seed на проде не запускается. Ключ флага
 * (`@RequireFeature('…')` или `FeatureFlagService.isEnabled('…')`) без
 * `INSERT` в миграциях означает 404/тихое отключение модуля на чистой
 * установке, без ошибки в логах. Страж валит гейты, если новый модуль с
 * флагом добавили без миграции.
 *
 * `isEnabled` собирается и из литеральных вызовов: ключи, которые читаются
 * только сервисом (например `mail-reception`), иначе оставались бы вне
 * инвентаря. Динамический аргумент (`isEnabled(flag)`) — слепая зона, поэтому
 * он попадает в `invalid` (кроме инфраструктуры: определение сервиса и guard,
 * где ключ приходит из декоратора и уже учтён).
 */

const SRC = import.meta.dirname;
const MIGRATIONS = join(SRC, '..', 'prisma', 'migrations');

/** Инфраструктура: динамический ключ не флаг-инвентарь, а механизм. */
const DYNAMIC_CALL_FILES = new Set([
  'core/feature-flags/feature-flag.service.ts',
  'core/guards/feature-flag.guard.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Комментарии не декораторы: пример `@RequireFeature('…')` в JSDoc гварда
 *  не должен попасть в инвентарь. Строки при этом сохраняются как есть. */
function stripComments(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      result += ch;
      i += 1;
      while (i < source.length) {
        result += source[i];
        if (source[i] === '\\') {
          result += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        i += 1;
        if (source[i - 1] === ch) break;
      }
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

/** Ключи из одного файла: декораторы и литеральные `isEnabled('…')`. */
function keysFromSource(source: string, file: string): { keys: string[]; invalid: string[] } {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const keys = new Set<string>();
  const invalid: string[] = [];

  const decorator = /@RequireFeature\(\s*([^)]*?)\s*\)/g;
  for (const match of source.matchAll(decorator)) {
    const arg = match[1] ?? '';
    const literal = /^(['"])([^'"]+)\1$/.exec(arg);
    if (!literal) {
      invalid.push(`${rel}: @RequireFeature(${arg})`);
      continue;
    }
    keys.add(literal[2]!);
  }

  if (!DYNAMIC_CALL_FILES.has(rel)) {
    const call = /\bisEnabled\(\s*([^)]*?)\s*\)/g;
    for (const match of source.matchAll(call)) {
      const arg = match[1] ?? '';
      const literal = /^(['"])([^'"]+)\1$/.exec(arg);
      if (!literal) {
        invalid.push(`${rel}: isEnabled(${arg})`);
        continue;
      }
      keys.add(literal[2]!);
    }
  }

  return { keys: [...keys], invalid };
}

/** Ключи всех флагов и подозрительные не-литералы (инвентаризация их слепа). */
function flagInventory(): { keys: string[]; invalid: string[] } {
  const keys = new Set<string>();
  const invalid: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const found = keysFromSource(stripComments(readFileSync(file, 'utf8')), file);
    for (const key of found.keys) keys.add(key);
    invalid.push(...found.invalid);
  }
  return { keys: [...keys].sort(), invalid };
}

/** Ключи из всех `INSERT INTO "feature_flags" … VALUES ('key', true|false, …)`. */
function migrationFlagKeys(): string[] {
  const insert = /INSERT\s+INTO\s+"feature_flags"[\s\S]*?;/gi;
  const row = /\(\s*'([^']+)'\s*,\s*(?:true|false)\b/gi;
  const keys = new Set<string>();
  for (const entry of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sql = readFileSync(join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8');
    for (const statement of sql.matchAll(insert)) {
      for (const value of statement[0].matchAll(row)) keys.add(value[1]!);
    }
  }
  return [...keys].sort();
}

describe('Фичефлаги в миграциях (I10, #866/AUD-017, #878)', () => {
  it('находит декораторы, вызовы isEnabled и вставки (страж не проходит вхолостую)', () => {
    const { keys } = flagInventory();
    expect(keys.length).toBeGreaterThan(0);
    // Ключ, который читается только через isEnabled (без @RequireFeature).
    expect(keys).toContain('mail-reception');
    expect(migrationFlagKeys().length).toBeGreaterThan(0);
  });

  it('ключ флага — строковый литерал (иначе инвентаризация слепа)', () => {
    expect(flagInventory().invalid).toEqual([]);
  });

  it('динамический isEnabled вне инфраструктуры — находка, литерал — ключ', () => {
    const found = keysFromSource(
      [
        "await this.flags.isEnabled('mail-reception');",
        'await this.flags.isEnabled(dynamicKey);',
      ].join('\n'),
      join(SRC, 'modules', 'example', 'example.service.ts'),
    );
    expect(found.keys).toEqual(['mail-reception']);
    expect(found.invalid).toEqual(['modules/example/example.service.ts: isEnabled(dynamicKey)']);
  });

  it('каждый ключ флага создаётся миграцией (прод = migrate deploy без seed)', () => {
    const created = new Set(migrationFlagKeys());
    const missing = flagInventory().keys.filter((key) => !created.has(key));
    expect(
      missing,
      'добавь INSERT INTO "feature_flags" … ON CONFLICT ("key") DO NOTHING в новую миграцию',
    ).toEqual([]);
  });
});
