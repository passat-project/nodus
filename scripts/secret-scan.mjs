#!/usr/bin/env node
/**
 * Проверка секретов перед коммитом (#706).
 *
 * Ищет `gitleaks` в PATH и сканирует staged-изменения. Если бинаря нет —
 * предупреждает и НЕ блокирует коммит: жёсткий барьер остаётся в CI
 * (`.github/workflows/ci.yml`, job `secrets`), локально это страховка.
 *
 * Запуск: node scripts/secret-scan.mjs [--staged|--all]
 */
import { spawnSync } from 'node:child_process';

const mode = process.argv.includes('--all') ? ['dir', '.'] : ['git', '--staged'];
const bin = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';

const probe = spawnSync(bin, ['version'], { encoding: 'utf8', shell: false });
if (probe.error?.code === 'ENOENT') {
  console.warn(
    '[secret-scan] gitleaks не найден — локальная проверка пропущена. CI поймает секрет; ' +
      'поставить локально: https://github.com/gitleaks/gitleaks#installing',
  );
  process.exit(0);
}

const args = [...mode, '--config', '.gitleaks.toml', '--redact', '--verbose'];
const result = spawnSync(bin, args, { stdio: 'inherit', shell: false });

if (result.status === 0) process.exit(0);

console.error(
  '\n[secret-scan] Найдены похожие на секреты строки. Коммит остановлен.\n' +
    'Уберите значение из diff (перенесите в .env или в переменную окружения). ' +
    'Ложное срабатывание — добавьте в .gitleaks.toml (allowlist) с причиной.',
);
process.exit(1);
