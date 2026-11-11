type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** UUID v4 из 16 случайных байт (RFC 4122: версия 4, вариант 10xx). */
export function uuidV4FromBytes(source: Uint8Array): Uuid {
  const bytes = Uint8Array.from(source.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
}

/**
 * Песочница по LAN открывается как `http://<LAN-IP>:4173` — это не secure
 * context, где `crypto.randomUUID` отсутствует. Без него первый же POST падает
 * TypeError (Idempotency-Key в api-client), т.е. с телефона нельзя даже войти.
 * `crypto.getRandomValues` доступен и по HTTP — на нём и строим полифилл (#675).
 */
export function installLanCrypto(target: Crypto = globalThis.crypto): void {
  const api = target as Crypto & { randomUUID?: () => Uuid };
  if (typeof api.randomUUID === 'function') return;
  if (typeof api.getRandomValues !== 'function') return;
  api.randomUUID = () => uuidV4FromBytes(api.getRandomValues(new Uint8Array(16)));
}
