import { describe, expect, it } from 'vitest';

import { installLanCrypto, uuidV4FromBytes } from './lan-crypto.js';

function fakeCrypto(randomUUID?: () => string): Crypto {
  return {
    ...(randomUUID ? { randomUUID } : {}),
    getRandomValues: (array: Uint8Array) => array.fill(0x11),
  } as unknown as Crypto;
}

describe('LAN-полифилл crypto.randomUUID (#675)', () => {
  it('собирает UUID v4 с версией и вариантом по RFC 4122', () => {
    expect(uuidV4FromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
    expect(uuidV4FromBytes(new Uint8Array(16).fill(0xff))).toBe(
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
    );
  });

  it('ставит полифилл, когда randomUUID недоступен (HTTP по LAN)', () => {
    const crypto = fakeCrypto();
    installLanCrypto(crypto);
    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('не перетирает нативный randomUUID', () => {
    const native = () => 'native-uuid';
    const crypto = fakeCrypto(native);
    installLanCrypto(crypto);
    expect(crypto.randomUUID).toBe(native);
  });
});
