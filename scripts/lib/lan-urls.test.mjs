import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { collectLanAddresses, formatLanUrls, isPrivateIPv4 } from './lan-urls.mjs';

const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal });
const v6 = (address, internal = false) => ({ address, family: 'IPv6', internal });

describe('lan-urls (#675)', () => {
  it('приватный IPv4 — только RFC 1918', () => {
    for (const address of ['10.0.0.1', '172.16.9.151', '172.31.255.254', '192.168.1.10']) {
      assert.equal(isPrivateIPv4(address), true, address);
    }
    for (const address of [
      '172.32.0.1',
      '169.254.10.20',
      '127.0.0.1',
      '100.64.0.1',
      '8.8.8.8',
      '10.0.0',
      '10.0.0.256',
      'abc',
      '',
    ]) {
      assert.equal(isPrivateIPv4(address), false, address);
    }
  });

  it('собирает приватные IPv4 всех интерфейсов, пропуская loopback/link-local/IPv6', () => {
    const addresses = collectLanAddresses({
      Loopback: [v4('127.0.0.1', true), v6('::1', true)],
      Ethernet: [v4('172.16.9.151'), v6('fe80::1')],
      'Wi-Fi': [v4('192.168.1.20'), v4('169.254.10.20')],
      vEthernet: [v4('8.8.8.8')],
    });

    assert.deepEqual(addresses, [
      { name: 'Ethernet', address: '172.16.9.151' },
      { name: 'Wi-Fi', address: '192.168.1.20' },
    ]);
  });

  it('понимает числовое family (старые версии Node) и пустой список', () => {
    assert.deepEqual(
      collectLanAddresses({ eth0: [{ address: '10.1.2.3', family: 4, internal: false }] }),
      [{ name: 'eth0', address: '10.1.2.3' }],
    );
    assert.deepEqual(collectLanAddresses({}), []);
    assert.deepEqual(collectLanAddresses({ lo: [v4('127.0.0.1', true)] }), []);
  });

  it('форматирует URL с портом и подсказкой интерфейса', () => {
    assert.deepEqual(
      formatLanUrls(4173, [
        { name: 'Ethernet', address: '172.16.9.151' },
        { name: 'Wi-Fi', address: '192.168.1.20' },
      ]),
      ['http://172.16.9.151:4173 (Ethernet)', 'http://192.168.1.20:4173 (Wi-Fi)'],
    );
    assert.deepEqual(formatLanUrls(4173, []), []);
  });
});
