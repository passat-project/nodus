import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission, projectDetailSchema } from '@nodus/contracts';

import { FeatureFlagService } from '../../src/core/feature-flags/feature-flag.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * AUD-013 (#866): статусные действия проекта проверяют права по свежей
 * строке под `FOR UPDATE`. Конкурентные пары запросов по 20 повторов на
 * живой БД: итог не должен зависеть от того, чей запрос успел первым.
 */
describe.skipIf(!process.env.DATABASE_URL)('projects: гонки статусов и передачи (AUD-013)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
  let alice: ChatUser;
  let bob: ChatUser;
  let carol: ChatUser;
  let typeId: string;
  const projectIds: string[] = [];
  const ROUNDS = 20;

  beforeAll(async () => {
    fx = await setupChatFixture(['alice', 'bob', 'carol']);
    const flags = fx.app.get(FeatureFlagService);
    for (const flag of ['projects', 'tasks', 'chat']) {
      await fx.prisma.featureFlag.upsert({
        where: { key: flag },
        update: { enabled: true },
        create: { key: flag, enabled: true },
      });
      await flags.setEnabled(flag, true);
    }
    const tokens = fx.app.get(TokenService);
    const mint = async (u: ChatUser, permissions: Permission[]): Promise<ChatUser> => ({
      ...u,
      token: await tokens.signAccessToken(
        { id: u.id, email: u.email, displayName: u.displayName, permissions },
        'integration-test-session',
      ),
    });
    const base = [Permission.PROJECT_CREATE, Permission.TASK_CREATE];
    alice = await mint(fx.users.alice, base);
    bob = await mint(fx.users.bob, base);
    carol = await mint(fx.users.carol, base);
    const types = (await (await fx.api(alice, 'GET', '/projects/types')).json()) as {
      id: string;
    }[];
    typeId = types[0]!.id;
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      if (projectIds.length > 0) {
        await fx.prisma.conversation.deleteMany({
          where: { projectId: { in: projectIds }, type: 'project_channel' },
        });
        await fx.prisma.project.deleteMany({ where: { id: { in: projectIds } } });
        await fx.prisma.event.deleteMany({
          where: { aggregateType: 'project', aggregateId: { in: projectIds } },
        });
      }
      await fx.prisma.task.deleteMany({
        where: { creatorId: { in: Object.values(fx.users).map((u) => u.id) } },
      });
    }
    await fx?.cleanup();
  });

  async function createProject(
    actor: ChatUser,
    body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const res = await fx.api(actor, 'POST', '/projects', {
      body: {
        typeId,
        code: `CI-race-${fx.runId}-${projectIds.length}`,
        ...body,
      },
      key: `race-${fx.runId}-${projectIds.length}`,
    });
    expect(res.status).toBe(201);
    const detail = projectDetailSchema.parse(await res.json());
    projectIds.push(detail.id);
    return { id: detail.id };
  }

  async function detailOf(projectId: string) {
    const res = await fx.api(alice, 'GET', `/projects/${projectId}`);
    return projectDetailSchema.parse(await res.json());
  }

  it('архивация руководителем и завершение помощником: заморозку не перебить, итог — архив', async () => {
    // carol — помощник без project.manage: вернуть из архива ей нельзя.
    const project = await createProject(bob, {
      name: `Гонка архива ${fx.runId}`,
      managerId: bob.id,
      assistantIds: [carol.id],
    });
    for (let round = 0; round < ROUNDS; round += 1) {
      if (round > 0) {
        const reset = await fx.api(bob, 'POST', `/projects/${project.id}/status`, {
          body: { status: 'active' },
        });
        expect(reset.status).toBe(200);
      }
      await Promise.all([
        fx.api(bob, 'POST', `/projects/${project.id}/status`, { body: { status: 'archived' } }),
        fx.api(carol, 'POST', `/projects/${project.id}/status`, { body: { status: 'completed' } }),
      ]);
      // Если помощник успел завершить до архивации — руководитель всё равно
      // архивирует; после архивации завершение помощнику запрещено.
      expect((await detailOf(project.id)).status).toBe('archived');
    }
  });

  it('две параллельные передачи руководства: ровно одна успешна, вторая — 403', async () => {
    const project = await createProject(bob, {
      name: `Гонка передачи ${fx.runId}`,
      managerId: bob.id,
    });
    const byId = (id: string | undefined): ChatUser | undefined =>
      Object.values(fx.users).find((u) => u.id === id);
    for (let round = 0; round < ROUNDS; round += 1) {
      const [toAlice, toCarol] = await Promise.all([
        fx.api(bob, 'POST', `/projects/${project.id}/transfer`, { body: { managerId: alice.id } }),
        fx.api(bob, 'POST', `/projects/${project.id}/transfer`, { body: { managerId: carol.id } }),
      ]);
      expect([toAlice.status, toCarol.status].sort()).toEqual([200, 403]);

      // Сброс: действующий руководитель возвращает руководство bob.
      const current = byId((await detailOf(project.id)).manager?.id);
      expect(current).toBeDefined();
      const reset = await fx.api(current!, 'POST', `/projects/${project.id}/transfer`, {
        body: { managerId: bob.id },
      });
      expect(reset.status).toBe(200);
    }
  });
});
