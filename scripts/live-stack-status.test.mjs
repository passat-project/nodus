import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { printStatus } from './live-stack-status.mjs';

const LAN = [{ name: 'Ethernet', address: '172.16.9.151' }];

async function statusLines(overrides) {
  const lines = [];
  const spy = mock.method(console, 'log', (line) => lines.push(String(line)));
  try {
    await printStatus({
      pids: { api: 1, gateway: 2, web: 3 },
      pidAlive: () => true,
      portBusy: async () => false,
      ports: { api: 3011, gateway: 3012, web: 4173 },
      lan: LAN,
      mode: 'dev',
      ...overrides,
    });
  } finally {
    spy.mock.restore();
  }
  return lines;
}

const lanLines = (lines) => lines.filter((line) => line.startsWith('LAN'));

describe('live-stack status: LAN-адреса (#675)', () => {
  it('в LAN-режиме печатает адреса web с именем интерфейса', async () => {
    assert.deepEqual(lanLines(await statusLines({ mode: 'dev' })), [
      'LAN      http://172.16.9.151:4173 (Ethernet)',
    ]);
  });

  it('--local: LAN выключен, адресов нет', async () => {
    const lines = lanLines(await statusLines({ mode: 'dev+local' }));
    assert.deepEqual(lines, ['LAN      выключен (--local): доступ только с этого ПК']);
  });

  it('без приватных IPv4 честно говорит, что LAN нет', async () => {
    assert.deepEqual(lanLines(await statusLines({ lan: [] })), [
      'LAN      нет приватных IPv4 — доступ только с этого ПК',
    ]);
  });

  it('стек не запущен — строки LAN нет', async () => {
    assert.deepEqual(lanLines(await statusLines({ mode: null })), []);
  });
});
