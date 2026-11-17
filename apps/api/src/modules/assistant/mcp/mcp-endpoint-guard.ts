import { isIP } from 'node:net';

import { McpError } from './mcp-error.js';

/** Внутренние домены, которые не должны получать ключ сервера. */
const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];

/**
 * Гвард адреса MCP-сервера (находка security-ревью 17.11.2026): ключ уходит
 * на этот адрес, поэтому наружу — только https, порт 443 и публичный хост.
 * Loopback, приватные и link-local литературы блокируются здесь, а не только
 * схемой настроек: защита в глубину (адрес задаёт администратор портала).
 * DNS-резолв не проверяется — для этого нужен кастомный lookup.
 */
export function assertAllowedEndpoint(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpError('Адрес MCP-сервера некорректен', 'transport', 'url');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new McpError(
      'MCP-сервер доступен только по https без логина и пароля',
      'transport',
      'url',
    );
  }
  if (url.port && url.port !== '443') {
    throw new McpError('MCP-сервер доступен только на порту 443', 'transport', 'url');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    isPrivateAddress(host)
  ) {
    throw new McpError(
      'Адрес MCP-сервера указывает во внутреннюю сеть',
      'transport',
      'private_address',
    );
  }
}

/** Литерал приватного/служебного IP (IPv4/IPv6). Резолв DNS — вне гварда. */
export function isPrivateAddress(host: string): boolean {
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    const lower = host.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    // fc00::/7 (unique local), fe80::/10 (link-local), ff00::/8 (multicast).
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
    if (/^ff[0-9a-f]{2}:/.test(lower)) return true;
    // WHATWG-URL нормализует IPv4-mapped в hex (`::ffff:7f00:1`) —
    // разворачиваем обе формы и проверяем как IPv4.
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (dotted?.[1]) return isPrivateAddress(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hex?.[1] && hex[2]) {
      const hi = Number.parseInt(hex[1], 16);
      const lo = Number.parseInt(hex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
  return false;
}
