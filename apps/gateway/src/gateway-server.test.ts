import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

import { createGatewayServer, type GatewayServer } from './gateway-server.ts';
import type { MembershipStore, UserStatusReader } from './membership.ts';

/** /health отражает способность доставлять события (AUD-021, #866):
 *  нет соединения с Redis — 503/status unavailable, готов — 200/ok. */
describe('GET /health gateway (AUD-021)', () => {
  const servers: GatewayServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  const store = {
    isMember: vi.fn(),
    memberIds: vi.fn(),
    userRef: vi.fn(),
    isActiveUser: vi.fn(),
  } as unknown as MembershipStore & UserStatusReader;

  async function startWithRedisStatus(status: string): Promise<string> {
    const gateway = createGatewayServer({
      jwtSecret: 'test-secret-32-chars-aaaaaaaaaaaa',
      store,
      redis: { status } as unknown as Redis,
    });
    servers.push(gateway);
    await new Promise<void>((resolve) => {
      gateway.httpServer.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const port = (gateway.httpServer.address() as { port: number }).port;
    return `http://127.0.0.1:${port}/health`;
  }

  it('нет соединения с Redis — 503, status unavailable', async () => {
    const url = await startWithRedisStatus('reconnecting');

    const response = await fetch(url);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'unavailable' });
  });

  it('Redis готов, чтение не падало — 200, status ok', async () => {
    const url = await startWithRedisStatus('ready');

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });
});
