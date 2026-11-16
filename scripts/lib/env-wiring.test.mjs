import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Страж проводки env api (AUD-025, #866) — в `scripts/`, потому что шаг
 * `pnpm test:scripts` в CI выполняется ВСЕГДА, а turbo-тесты пакетов — только
 * по изменённым путям: правка одного docker-compose.yml иначе прошла бы мимо.
 *
 * Механизм ловушки (`docs/gotchas/docker-infra.md`): у сервиса api нет
 * `env_file`, compose подставляет переменные только в файл, а в процесс
 * уходят лишь ключи из `environment:` — новая настройка молча работает на
 * дефолтах приложения (репро #577, #715). Контракт: каждая переменная схемы
 * api, ОПИСАННАЯ в `.env.example` (то есть заявленная как настройка), либо
 * проведена в `environment:` сервиса api, либо внесена в EXCEPTIONS с
 * объяснением. Переменные схемы, которых в `.env.example` нет (внутренний
 * тюнинг тестов/лимитов), предметом стража не являются.
 *
 * `docker compose config` этого не ловит: он показывает подстановку в файле,
 * а не env контейнера.
 */

const ROOT = new URL('../../', import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, ROOT), 'utf8');
}

/** Ключи объекта envSchema: `KEY: z...` или `KEY: z` + перенос строки. */
export function schemaEnvKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/^ {4}([A-Z][A-Z0-9_]*):\s*z\b/gm)) keys.add(match[1]);
  return keys;
}

/** Переменные, описанные в .env.example: активные И закомментированные шаблоны. */
export function exampleEnvKeys(source) {
  const keys = new Set();
  for (const line of source.split('\n')) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/** Ключи `environment:` сервиса api базового docker-compose.yml. */
export function composeServiceEnvKeys(source, service = 'api') {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `  ${service}:`);
  assert.notEqual(start, -1, `сервис ${service} не найден в compose`);

  const keys = new Set();
  let inEnvironment = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    // Следующий сервис (или корневая секция вроде networks:) на два пробела.
    if (/^ {2}[A-Za-z0-9_-]+:/.test(line)) break;
    if (/^ {4}environment:\s*$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (!inEnvironment) continue;
    // Другая секция сервиса (ports:, depends_on:, ...) — environment закончился.
    if (/^ {4}[A-Za-z0-9_-]+:/.test(line)) {
      inEnvironment = false;
      continue;
    }
    const match = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/**
 * Переменные, которые сознательно НЕ проводятся в контейнер.
 * Формат: ключ → причина. Пусто — все описанные настройки api обязаны
 * работать из `.env`; исключение допустимо, только если значение намеренно
 * живёт лишь на хосте (объясните это здесь).
 */
const EXCEPTIONS = Object.freeze({});

describe('проводка env api (docker-compose.yml)', () => {
  const schema = schemaEnvKeys(read('apps/api/src/core/config/env.schema.ts'));
  const example = exampleEnvKeys(read('.env.example'));
  const compose = composeServiceEnvKeys(read('docker-compose.yml'));

  it('парсеры видят переменные — иначе страж смотрит в пустоту', () => {
    assert.ok(schema.has('JWT_SECRET'), 'схема: не найден JWT_SECRET');
    assert.ok(schema.has('NODUS_MIN_SHELL_VERSION'), 'схема: не найден NODUS_MIN_SHELL_VERSION');
    assert.ok(example.has('NODUS_SERVER_NAME'), '.env.example: не найден NODUS_SERVER_NAME');
    assert.ok(compose.has('DATABASE_URL'), 'compose: не найден DATABASE_URL');
    assert.ok(compose.has('NODUS_SERVER_NAME'), 'compose: не найден NODUS_SERVER_NAME');
  });

  it('каждое исключение объяснено', () => {
    for (const [key, reason] of Object.entries(EXCEPTIONS)) {
      assert.ok(reason.trim().length > 10, `${key}: исключение без объяснения`);
    }
  });

  const described = [...schema].filter((key) => example.has(key)).sort();

  it('в .env.example описаны настройки api — список не пуст', () => {
    assert.ok(described.length > 10, `описанных настроек api: ${described.length}`);
  });

  for (const key of described) {
    it(`${key}: проведена в environment сервиса api`, () => {
      const handled = compose.has(key) || Object.hasOwn(EXCEPTIONS, key);
      assert.ok(
        handled,
        `${key}: есть в схеме api и .env.example, но нет в environment сервиса api ` +
          '(docker-compose.yml) и не в списке исключений — значение из .env ' +
          'в контейнер не доедет',
      );
    });
  }
});
