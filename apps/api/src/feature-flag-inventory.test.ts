import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Инвентаризация фичефлагов (I10, #866/AUD-017): прод-образ выполняет только
 * `prisma migrate deploy` — seed на проде не запускается. Ключ
 * `@RequireFeature('…')` без `INSERT` в миграциях означает 404 на весь модуль
 * на чистой установке, без ошибки в логах. Страж валит гейты, если новый
 * модуль с флагом добавили без миграции.
 */

const SRC = import.meta.dirname;
const MIGRATIONS = join(SRC, '..', 'prisma', 'migrations');

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

/** Ключи флагов из кода: декораторы `@RequireFeature('…')` И чтения
 *  `FeatureFlagService.isEnabled('…')` (#878/AUD-017). Второй путь раньше
 *  был вне инвентаризации: новый модуль с isEnabled-only флагом мог остаться
 *  без миграции незамеченным. Не-литералы — в `invalid` (страж их слеп). */
export function collectFlagKeys(rawSource: string): { keys: string[]; invalid: string[] } {
  // Комментарии не считаем: `@RequireFeature('…')` в JSDoc — не инвентаризация.
  const source = stripComments(rawSource);
  const decorator = /@RequireFeature\(\s*([^)]*?)\s*\)/g;
  const enabledCall = /\.isEnabled\(\s*([^)]*?)\s*\)/g;
  const keys = new Set<string>();
  const invalid: string[] = [];
  const collect = (pattern: RegExp, label: string): void => {
    for (const match of source.matchAll(pattern)) {
      const arg = match[1] ?? '';
      const literal = /^(['"])([^'"]+)\1$/.exec(arg);
      if (!literal) {
        invalid.push(`${label}(${arg})`);
        continue;
      }
      keys.add(literal[2]!);
    }
  };
  collect(decorator, '@RequireFeature');
  collect(enabledCall, '.isEnabled');
  return { keys: [...keys].sort(), invalid };
}

/** Файлы, где `isEnabled` вызывается с ключом из декоратора: сам гейт
 *  флагов. Его аргумент — переменная, но ключ всё равно в инвентаризации
 *  (через `@RequireFeature`), поэтому это не слепое место. */
const DYNAMIC_IS_ENABLED = new Set([join('core', 'guards', 'feature-flag.guard.ts')]);

/** Ключи флагов по всем исходникам API (без тестов) и их файлы — для подсказки. */
function codeFlagKeys(): { keys: string[]; invalid: string[] } {
  const keys = new Set<string>();
  const invalid: string[] = [];
  for (const file of sourceFiles(SRC)) {
    if (DYNAMIC_IS_ENABLED.has(relative(SRC, file))) continue;
    const found = collectFlagKeys(readFileSync(file, 'utf8'));
    for (const key of found.keys) keys.add(key);
    for (const problem of found.invalid) invalid.push(`${relative(SRC, file)}: ${problem}`);
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
  it('находит декораторы и вставки (страж не проходит вхолостую)', () => {
    expect(codeFlagKeys().keys.length).toBeGreaterThan(0);
    expect(migrationFlagKeys().length).toBeGreaterThan(0);
  });

  it('ключ @RequireFeature и isEnabled — строковый литерал (иначе инвентаризация слепа)', () => {
    expect(codeFlagKeys().invalid).toEqual([]);
  });

  it('каждый ключ из кода создаётся миграцией (прод = migrate deploy без seed)', () => {
    const created = new Set(migrationFlagKeys());
    const missing = codeFlagKeys().keys.filter((key) => !created.has(key));
    expect(
      missing,
      'добавь INSERT INTO "feature_flags" … ON CONFLICT ("key") DO NOTHING в новую миграцию',
    ).toEqual([]);
  });

  it('флаг, читаемый только через isEnabled, тоже попадает в инвентаризацию (#878)', () => {
    const { keys, invalid } = collectFlagKeys(`
      if (!(await this.flags.isEnabled('mail-reception'))) return;
      // .isEnabled('в-комментарии') не считается
      /* @RequireFeature('тоже-комментарий') */
    `);
    expect(keys).toEqual(['mail-reception']);
    expect(invalid).toEqual([]);
  });

  it('не-литерал в isEnabled — страж не молчит', () => {
    const { invalid } = collectFlagKeys(`await flags.isEnabled(key);`);
    expect(invalid).toEqual(['.isEnabled(key)']);
  });
});
