import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { officeEnabled, printLanHint, resolveApiHost } from './live-stack-lan.mjs';

function capture(stream, fn) {
  const lines = [];
  const spy = mock.method(console, stream, (line) => lines.push(String(line)));
  try {
    fn();
  } finally {
    spy.mock.restore();
  }
  return lines;
}

describe('live-stack LAN-режим (#675)', () => {
  it('OFFICE_ENABLED понимает значения .env', () => {
    for (const value of ['true', '1', 'yes', 'ON']) {
      assert.equal(officeEnabled({ OFFICE_ENABLED: value }), true, value);
    }
    for (const value of ['false', '0', '', undefined]) {
      assert.equal(officeEnabled({ OFFICE_ENABLED: value }), false, String(value));
    }
  });

  it('api по умолчанию loopback, OFFICE_ENABLED открывает 0.0.0.0, --local главнее', () => {
    const warned = [];
    const spy = mock.method(console, 'warn', (line) => warned.push(String(line)));
    try {
      assert.equal(resolveApiHost({ local: false, office: false }), '127.0.0.1');
      assert.equal(resolveApiHost({ local: false, office: true }), '0.0.0.0');
      assert.equal(resolveApiHost({ local: true, office: false }), '127.0.0.1');
      assert.equal(resolveApiHost({ local: true, office: true }), '127.0.0.1');
    } finally {
      spy.mock.restore();
    }
    // Исключение ONLYOFFICE и несовместимость с --local проговариваются явно.
    assert.equal(warned.length, 2);
    assert.match(warned[0], /OFFICE_ENABLED=true.*0\.0\.0\.0/);
    assert.match(warned[1], /--local.*ONLYOFFICE/);
  });

  it('--local не печатает LAN-адреса', () => {
    const logs = capture('log', () =>
      printLanHint(4173, true, [{ name: 'Ethernet', address: '10.0.0.5' }]),
    );
    assert.deepEqual(logs, ['LAN: выключен (--local) — песочница доступна только с этого ПК.']);
  });

  it('печатает все LAN-адреса web и предупреждение о безопасности', () => {
    const logs = capture('log', () =>
      printLanHint(4173, false, [
        { name: 'Ethernet', address: '172.16.9.151' },
        { name: 'Wi-Fi', address: '192.168.1.20' },
      ]),
    );
    const warnings = capture('warn', () =>
      printLanHint(4173, false, [{ name: 'Ethernet', address: '172.16.9.151' }]),
    );
    assert.deepEqual(logs, [
      'LAN (телефон/коллеги в той же сети):',
      '  http://172.16.9.151:4173 (Ethernet)',
      '  http://192.168.1.20:4173 (Wi-Fi)',
    ]);
    assert.match(warnings.join('\n'), /ПУБЛИЧНЫМИ паролями/);
    assert.match(warnings.join('\n'), /входящий TCP 4173/);
  });

  it('без приватных IPv4 честно говорит, что LAN нет', () => {
    const logs = capture('log', () => printLanHint(4173, false, []));
    assert.deepEqual(logs, [
      'LAN: приватных IPv4 не найдено — доступ только с этого ПК (проверьте сеть).',
    ]);
  });
});
