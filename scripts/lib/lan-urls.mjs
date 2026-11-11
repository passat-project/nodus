/**
 * LAN-адреса песочницы (#675): web по умолчанию слушает 0.0.0.0, и коллеге
 * с телефоном нужен адрес вида `http://<LAN-IP>:4173`. Годятся только
 * приватные IPv4 (RFC 1918): публичный адрес или link-local — не тот интерфейс.
 * Вынесено из live-stack.mjs (I5) и покрыто scripts/lib/lan-urls.test.mjs.
 */
import os from 'node:os';

/** Приватный IPv4 (10/8, 172.16/12, 192.168/16). Loopback, link-local и
 *  CGNAT сюда не входят: они не дают доступа из соседней комнаты. */
export function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4) return false;
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

/** LAN-адреса машины: имя интерфейса — подсказкой, порядок — как у ОС.
 *  `interfaces` параметром — чтобы тест не зависел от сети хоста. */
export function collectLanAddresses(interfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      const family = typeof entry.family === 'number' ? `IPv${entry.family}` : entry.family;
      if (family !== 'IPv4' || entry.internal) continue;
      if (!isPrivateIPv4(entry.address)) continue;
      addresses.push({ name, address: entry.address });
    }
  }
  return addresses;
}

/** `http://<ip>:<port> (интерфейс)` — готовые строки для up/status. */
export function formatLanUrls(port, addresses = collectLanAddresses()) {
  return addresses.map(({ name, address }) => `http://${address}:${port} (${name})`);
}
