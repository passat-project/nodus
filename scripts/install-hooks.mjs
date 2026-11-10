#!/usr/bin/env node
/**
 * Ставит git-хуки (#706).
 *
 * `prepare` из package.json выполняется и там, где репозитория нет: Dockerfile
 * собирает сервис из `turbo prune`-контекста без `.git`. В этом случае скрипт
 * молча выходит — хуки в образе не нужны. На существующих клонах остаётся
 * `core.hooksPath=.husky/_` от прошлого менеджера, его надо снять, иначе
 * `lefthook install` отказывается ставить хуки и валит `pnpm install`.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const isGitRepo = spawnSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' }).status === 0;
if (!isGitRepo) {
  console.log('[hooks] не git-репозиторий (например, docker build) — установка хуков пропущена');
  process.exit(0);
}

const legacy = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
  encoding: 'utf8',
});
if (legacy.stdout?.includes('.husky')) {
  spawnSync('git', ['config', '--local', '--unset-all', 'core.hooksPath']);
  console.log('[hooks] снят устаревший core.hooksPath от husky');
}

// Запуск через node, а не через `.cmd`: shell-режим ломается на путях
// с пробелами, и хуки молча не ставились бы.
const bin = require.resolve('lefthook');
const result = spawnSync(process.execPath, [bin, 'install'], { stdio: 'inherit' });

process.exit(result.status ?? 1);
