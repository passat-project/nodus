/**
 * LAN-режим песочницы (#675): какие интерфейсы открыты наружу, адреса для
 * телефона и предупреждение о безопасности. Вынесено из live-stack.mjs (I5),
 * покрыто scripts/lib/live-stack-lan.test.mjs.
 */
import { collectLanAddresses, formatLanUrls } from './lan-urls.mjs';

const TRUTHY = new Set(['true', '1', 'yes', 'on']);

/** OFFICE_ENABLED из env-строк (`.env` пишет true/1/yes/on). */
export function officeEnabled(env) {
  return TRUTHY.has(
    String(env.OFFICE_ENABLED ?? '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * Интерфейс api: наружу открыт только web, значит api — loopback. Исключение —
 * ONLYOFFICE: контейнер document-server ходит к api через host.docker.internal
 * (это НЕ loopback), поэтому при OFFICE_ENABLED=true api остаётся на 0.0.0.0.
 * `--local` главнее: доступ только с этого ПК.
 */
export function resolveApiHost({ local, office }) {
  if (local) {
    if (office) {
      console.warn(
        'sandbox: --local отключает LAN — ONLYOFFICE из контейнера не откроется (нужен host.docker.internal).',
      );
    }
    return '127.0.0.1';
  }
  if (office) {
    console.warn(
      'sandbox: OFFICE_ENABLED=true — api слушает 0.0.0.0 ради host.docker.internal (ONLYOFFICE). Наружу открывать только :4173.',
    );
    return '0.0.0.0';
  }
  return '127.0.0.1';
}

/** `--local` / отсутствие LAN / адреса web + предупреждение о тестовых паролях. */
export function printLanHint(port, local, addresses = collectLanAddresses()) {
  if (local) {
    console.log('LAN: выключен (--local) — песочница доступна только с этого ПК.');
    return;
  }
  if (addresses.length === 0) {
    console.log('LAN: приватных IPv4 не найдено — доступ только с этого ПК (проверьте сеть).');
    return;
  }
  console.log('LAN (телефон/коллеги в той же сети):');
  for (const url of formatLanUrls(port, addresses)) console.log(`  ${url}`);
  console.warn(
    'Внимание: тестовые пользователи песочницы — с ПУБЛИЧНЫМИ паролями; в интернет не публиковать.\n' +
      'Firewall: входящий TCP 4173 только для подсети команды; api :3011 и gateway :3012 наружу не открывать.',
  );
}
