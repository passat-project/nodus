import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * AUD-022 (integration, живое HTTP): пул api — 2 соединения. Синхронизация
 * канала проекта читает roster и название ДО транзакции, поэтому четыре
 * параллельных открытия канала не занимают второе соединение внутри tx
 * (до фикса каждое sync держало tx-соединение и ждало второе — при пуле 2
 * это взаимная блокировка до таймаута ожидания). statement_timeout из
 * окружения действует на запросы приложения.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'chat: синхронизация канала проекта при пуле из 2 соединений (AUD-022)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob'>;
    let alice: ChatUser;
    let bob: ChatUser;
    let projectId: string;

    beforeAll(async () => {
      // До поднятия AppModule: PrismaService читает пул при создании.
      process.env.DATABASE_POOL_MAX = '2';
      process.env.DATABASE_STATEMENT_TIMEOUT_MS = '3000';
      fx = await setupChatFixture(['alice', 'bob']);
      // Флаги модулей, нужные проекции проекта в канал.
      for (const flag of ['projects', 'tasks', 'chat']) {
        await fx.prisma.featureFlag.upsert({
          where: { key: flag },
          update: { enabled: true },
          create: { key: flag, enabled: true },
        });
      }
      const tokens = fx.app.get(TokenService);
      alice = {
        ...fx.users.alice,
        token: await tokens.signAccessToken(
          {
            id: fx.users.alice.id,
            email: fx.users.alice.email,
            displayName: fx.users.alice.displayName,
            permissions: [Permission.PROJECT_CREATE],
          },
          'integration-test-session',
        ),
      };
      bob = fx.users.bob;

      const types = (await (await fx.api(alice, 'GET', '/projects/types')).json()) as {
        id: string;
      }[];
      const typeId = types[0]?.id;
      if (!typeId) throw new Error('seed project type missing');
      const created = await fx.api(alice, 'POST', '/projects', {
        body: {
          typeId,
          code: `POOL-${fx.runId}`,
          name: `Пул ${fx.runId}`,
          managerId: alice.id,
          observers: [bob.id],
        },
        key: `pool-project-${fx.runId}`,
      });
      expect(created.status).toBe(201);
      projectId = ((await created.json()) as { id: string }).id;

      // Канал создаётся проекцией project.created (outbox ~50 мс, бюджет 5 с).
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (
          await fx.prisma.conversation.findFirst({
            where: { projectId, type: 'project_channel' },
            select: { id: true },
          })
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('project channel not created');
    }, 120_000);

    afterAll(async () => {
      delete process.env.DATABASE_POOL_MAX;
      delete process.env.DATABASE_STATEMENT_TIMEOUT_MS;
      if (fx) {
        const project = await fx.prisma.project.findFirst({
          where: { creatorId: alice.id },
          select: { id: true },
        });
        if (project) {
          await fx.prisma.conversation.deleteMany({
            where: { projectId: project.id, type: 'project_channel' },
          });
          await fx.prisma.project.delete({ where: { id: project.id } });
          await fx.prisma.event.deleteMany({
            where: { aggregateType: 'project', aggregateId: project.id },
          });
        }
      }
      await fx?.cleanup();
    });

    it('четыре параллельных открытия канала проходят на пуле из 2 соединений', async () => {
      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          fx.api(
            index % 2 === 0 ? alice : bob,
            'GET',
            `/chat/conversations/by-project/${projectId}`,
          ),
        ),
      );
      for (const response of responses) expect(response.status).toBe(200);
    });

    it('statement_timeout из окружения обрывает зависший запрос', async () => {
      const rows =
        await fx.prisma.$queryRawUnsafe<{ statement_timeout: string }[]>('SHOW statement_timeout');
      expect(rows[0]?.statement_timeout).toBe('3s');
      await expect(fx.prisma.$queryRawUnsafe('SELECT pg_sleep(5)')).rejects.toThrow();
    });
  },
);
