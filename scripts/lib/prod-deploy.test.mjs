// Тесты чистых функций выкатки прода (#565).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildComposeArgs, isAbsoluteHostPath, parseEnv, replaceEnvValue } from './prod-deploy.mjs';
import { imageLabelFormat, sanitizeEnv } from './prod-deploy-io.mjs';

test('parseEnv читает ключи, снимает кавычки и пропускает комментарии', () => {
  const env = parseEnv(
    ['# комментарий', 'A=1', "B='два слова'", 'C="три"', '', 'D=', 'E=a=b'].join('\n'),
  );
  assert.equal(env.A, '1');
  assert.equal(env.B, 'два слова');
  assert.equal(env.C, 'три');
  assert.equal(env.D, '');
  assert.equal(env.E, 'a=b');
});

test('replaceEnvValue меняет ровно одну строку и не трогает остальные', () => {
  const before = 'A=1\nNODUS_VERSION=0.4.0\nB=2\n';
  const after = replaceEnvValue(before, 'NODUS_VERSION', '0.5.0');
  assert.equal(after, 'A=1\nNODUS_VERSION=0.5.0\nB=2\n');
});

test('replaceEnvValue добавляет ключ, если его нет', () => {
  assert.equal(replaceEnvValue('A=1\n', 'NODUS_VERSION', '0.5.0'), 'A=1\nNODUS_VERSION=0.5.0\n');
  assert.equal(replaceEnvValue('', 'NODUS_VERSION', '0.5.0'), 'NODUS_VERSION=0.5.0\n');
});

test('replaceEnvValue отвергает дубли ключа', () => {
  assert.throws(
    () => replaceEnvValue('NODUS_VERSION=1\nNODUS_VERSION=2\n', 'NODUS_VERSION', '3'),
    /несколько строк/,
  );
});

test('isAbsoluteHostPath принимает Windows и POSIX, отвергает относительный', () => {
  assert.equal(isAbsoluteHostPath('D:/NodusProd/desktop'), true);
  assert.equal(isAbsoluteHostPath('D:\\NodusProd\\desktop'), true);
  assert.equal(isAbsoluteHostPath('/srv/nodus/desktop'), true);
  assert.equal(isAbsoluteHostPath('./infra/desktop-dist'), false);
  assert.equal(isAbsoluteHostPath('infra/desktop-dist'), false);
  assert.equal(isAbsoluteHostPath(''), false);
});

test('imageLabelFormat — ровно Go-шаблон без лишних символов', () => {
  // Регрессия #570: лишние кавычки/скобки в формате давали пустую метку,
  // и выкатка падала «образ собран из —» при правильном образе.
  assert.equal(
    imageLabelFormat('org.opencontainers.image.revision'),
    '{{index .Config.Labels "org.opencontainers.image.revision"}}',
  );
});

test('sanitizeEnv не пропускает прод-переменные и секреты оператора', () => {
  const env = sanitizeEnv({
    PATH: '/usr/bin',
    HOME: '/home/agent',
    NODUS_VERSION: '9.9.9',
    NODUS_REGISTRY: 'evil.example',
    COMPOSE_PROFILES: 'sandbox',
    JWT_SECRET: 'secret',
    POSTGRES_PASSWORD: 'secret',
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/agent');
  assert.equal(env.NODUS_VERSION, undefined);
  assert.equal(env.NODUS_REGISTRY, undefined);
  assert.equal(env.COMPOSE_PROFILES, undefined);
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.POSTGRES_PASSWORD, undefined);
});

test('buildComposeArgs собирает оверлей, env-файл и профили', () => {
  const args = buildComposeArgs({
    prodDir: 'D:/NodusProd',
    kitDir: 'D:/NodusProd/kit/v0.5.0',
    profiles: ['office', 'tunnel'],
  });
  assert.deepEqual(args, [
    '-p',
    'nodus',
    '--project-directory',
    'D:/NodusProd',
    '--env-file',
    'D:/NodusProd/.env',
    '-f',
    'D:/NodusProd/kit/v0.5.0/docker-compose.yml',
    '-f',
    'D:/NodusProd/kit/v0.5.0/compose.prod.yaml',
    '--profile',
    'office',
    '--profile',
    'tunnel',
  ]);
});
