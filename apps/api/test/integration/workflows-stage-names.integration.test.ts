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
    if (fx) {
      await fx.prisma.workflow.deleteMany({
        where: { name: { startsWith: `IT-${fx.runId}` } },
      });
      await fx.cleanup();
    }
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

  it('excludeWorkflowId убирает текущий маршрут, personal не попадает', async () => {
    const suffix = fx.runId;
    const taskWorkflow = await fx.prisma.workflow.create({
      data: {
        name: `IT-${suffix}-task`,
        kind: 'task',
        publishedAt: new Date(),
        stages: {
          create: [
            {
              name: `Этап ${suffix}`,
              color: 'info',
              systemState: 'active',
              sortOrder: 0,
              isInitial: true,
            },
          ],
        },
      },
    });
    await fx.prisma.workflow.create({
      data: {
        name: `IT-${suffix}-personal`,
        kind: 'personal',
        ownerId: admin.id,
        publishedAt: new Date(),
        stages: {
          create: [
            {
              name: `Этап ${suffix}`,
              color: 'neutral',
              systemState: 'active',
              sortOrder: 0,
              isInitial: true,
            },
          ],
        },
      },
    });

    const withoutExclude = await fx.api(admin, 'GET', '/workflows/stage-names?category=task');
    expect(withoutExclude.status).toBe(200);
    const all = (await withoutExclude.json()) as { name: string; routes: number }[];
    // Личный маршрут не считается: иначе routes было бы 2.
    expect(all.find((n) => n.name === `Этап ${suffix}`)?.routes).toBe(1);

    const withExclude = await fx.api(
      admin,
      'GET',
      `/workflows/stage-names?category=task&excludeWorkflowId=${taskWorkflow.id}`,
    );
    expect(withExclude.status).toBe(200);
    const filtered = (await withExclude.json()) as { name: string }[];
    expect(filtered.some((n) => n.name === `Этап ${suffix}`)).toBe(false);
  });
});
