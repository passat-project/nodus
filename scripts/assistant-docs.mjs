#!/usr/bin/env node
/**
 * Генерация документов ассистента (#926): карта поверхностей и стандарт
 * описания инструментов. Оба документа генерируются из каталога, руками не
 * правятся; тесты свежести падают, если документ отстал от кода.
 *
 * Почему враппер, а не `VAR=1 pnpm …` в package.json: на Windows pnpm
 * запускает скрипты через cmd, где POSIX-присваивание не работает. Враппер
 * ставит переменную кроссплатформенно и запускает тест генерации.
 *
 * Запуск: `pnpm assistant:surface`, `pnpm assistant:standard`.
 */

import { spawnSync } from 'node:child_process';

const MODES = {
  surface: {
    env: { UPDATE_ASSISTANT_SURFACE: '1' },
    file: 'src/modules/assistant/tools/surface.test.ts',
  },
  standard: {
    env: { UPDATE_ASSISTANT_STANDARD: '1' },
    file: 'src/modules/assistant/tools/manifest.test.ts',
  },
};

const mode = process.argv[2];
const config = MODES[mode];
if (!config) {
  console.error(`Укажи режим: ${Object.keys(MODES).join(' | ')}`);
  process.exit(2);
}

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--filter', '@nodus/api', 'exec', 'vitest', 'run', config.file],
  {
    stdio: 'inherit',
    env: { ...process.env, ...config.env },
    shell: process.platform === 'win32',
  },
);
process.exit(result.status ?? 1);
