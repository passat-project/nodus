import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/** #430: подсказки имён статусов — только настройщику, ответ — массив с
 *  системным этапом и числом маршрутов; текущий маршрут исключается. */
describe.skipIf(!process.env.DATABASE_URL)('workflow stage names (integration, #430)', () => {
  let fx: ChatTestFixture<'admin' | 'alice'>;
  let admin: ChatUser;
  let alice: ChatUser;

  beforeAll(async () => {
    fx = await setupChatFixture(['admin', 'alice']);
    const tokens = fx.app.get(TokenService);
    const sign = async (u: ChatUser, permissions: string[]) => ({
      ...u,
      token: await tokens.signAccessToken(
        { id: u.id, email: u.email, displayName: u.displayName, permissions },
        'integration-test-session',
      ),
    });
    admin = await sign(fx.users.admin, [Permission.WORKFLOW_MANAGE]);
    alice = await sign(fx.users.alice, []);
  }, 120_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it('без workflow.manage — 403', async () => {
    const res = await fx.api(alice, 'GET', '/workflows/stage-names?category=task');
    expect(res.status).toBe(403);
  });

  it('с правом — массив имён опубликованных маршрутов', async () => {
    const res = await fx.api(admin, 'GET', '/workflows/stage-names?category=task');
    expect(res.status).toBe(200);
    const names = (await res.json()) as { systemState: string; name: string; routes: number }[];
    expect(Array.isArray(names)).toBe(true);
    // Системный каталог входит в подсказки (code IS NOT NULL), поэтому в
    // свежей БД имена уже есть.
    expect(names.length).toBeGreaterThan(0);
    expect(
      names.every(
        (n) =>
          n.routes >= 1 &&
          ['backlog', 'active', 'paused', 'done', 'closed'].includes(n.systemState),
      ),
    ).toBe(true);
  });
});
