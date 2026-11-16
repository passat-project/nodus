import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * AUD-003 (integration, живое HTTP): канал проекта подчиняется правилам
 * проекта. Ручное добавление/исключение участников запрещено любой роли;
 * корневая пересылка проверяет `project.channel.post` (как обычная
 * отправка); треды канала и обычная отправка не изменились; синхронизация
 * состава из проекта по-прежнему добавляет и убирает участников.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'chat: канал проекта подчиняется правилам проекта (AUD-003)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob' | 'carol' | 'dave'>;
    let alice: ChatUser;
    let bob: ChatUser;
    let carol: ChatUser;
    let dave: ChatUser;
    let projectId: string;
    let channelId: string;
    let rootId: string;
    let keySeq = 0;

    const nextKey = (tag: string): string => `pch-${fx.runId}-${tag}-${(keySeq += 1)}`;

    /** Ждать проекцию outbox (участие/канал): доставка ~50 мс, бюджет 5 с. */
    async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`projection not ready: ${label}`);
    }

    async function channelMemberIds(): Promise<Set<string>> {
      const rows = await fx.prisma.conversationMember.findMany({
        where: { conversationId: channelId },
        select: { userId: true },
      });
      return new Set(rows.map((row) => row.userId));
    }

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob', 'carol', 'dave']);
      for (const flag of ['projects', 'tasks', 'chat']) {
        await fx.prisma.featureFlag.upsert({
          where: { key: flag },
          update: { enabled: true },
          create: { key: flag, enabled: true },
        });
      }
      const tokens = fx.app.get(TokenService);
      const mint = async (user: ChatUser, permissions: Permission[]): Promise<ChatUser> => ({
        ...user,
        token: await tokens.signAccessToken(
          { id: user.id, email: user.email, displayName: user.displayName, permissions },
          'integration-test-session',
        ),
      });
      alice = await mint(fx.users.alice, [Permission.PROJECT_CREATE]);
      bob = await mint(fx.users.bob, []);
      carol = await mint(fx.users.carol, []);
      dave = await mint(fx.users.dave, []);

      const typesRes = await fx.api(alice, 'GET', '/projects/types');
      expect(typesRes.status).toBe(200);
      const typeId = ((await typesRes.json()) as { id: string }[])[0]?.id;
      if (!typeId) throw new Error('seed project type missing');

      // Руководитель alice, помощник bob (management), наблюдатель carol
      // (обычный участник канала без права публикации).
      const created = await fx.api(alice, 'POST', '/projects', {
        body: {
          typeId,
          code: `AUD3-${fx.runId}`,
          name: `Канал правил ${fx.runId}`,
          managerId: alice.id,
          assistantIds: [bob.id],
          observers: [carol.id],
        },
        key: nextKey('project'),
      });
      expect(created.status).toBe(201);
      projectId = ((await created.json()) as { id: string }).id;

      await waitFor(async () => {
        const channel = await fx.prisma.conversation.findFirst({
          where: { projectId, type: 'project_channel' },
          select: { id: true },
        });
        if (!channel) return false;
        channelId = channel.id;
        const ids = await channelMemberIds();
        return ids.size === 3 && ids.has(dave.id) === false && ids.has(carol.id);
      }, 'channel roster [alice, bob, carol]');

      const post = await fx.api(alice, 'POST', `/chat/conversations/${channelId}/messages`, {
        body: { text: 'Пост руководителя проекта' },
        key: nextKey('root'),
      });
      expect(post.status).toBe(201);
      rootId = ((await post.json()) as { id: string }).id;
    }, 120_000);

    afterAll(async () => {
      if (fx) {
        const { alice: a, bob: b, carol: c, dave: d } = fx.users;
        const userIds = [a.id, b.id, c.id, d.id];
        const projects = await fx.prisma.project.findMany({
          where: { creatorId: { in: userIds } },
          select: { id: true },
        });
        const projectIds = projects.map((project) => project.id);
        if (projectIds.length > 0) {
          await fx.prisma.task.updateMany({
            where: { projectId: { in: projectIds } },
            data: { projectId: null },
          });
          await fx.prisma.conversation.deleteMany({
            where: { projectId: { in: projectIds }, type: 'project_channel' },
          });
          await fx.prisma.counterpartyUsage.deleteMany({
            where: { sourceId: { in: projectIds }, sourceKind: 'project' },
          });
          await fx.prisma.project.deleteMany({ where: { id: { in: projectIds } } });
          await fx.prisma.event.deleteMany({
            where: { aggregateType: 'project', aggregateId: { in: projectIds } },
          });
        }
      }
      await fx?.cleanup();
    });

    it('ручное добавление участника в канал проекта → отказ для любой роли', async () => {
      for (const actor of [alice, carol]) {
        const res = await fx.api(actor, 'POST', `/chat/conversations/${channelId}/members`, {
          body: { userIds: [dave.id] },
          key: nextKey(`add-${actor === alice ? 'owner' : 'member'}`),
        });
        expect([400, 403, 422]).toContain(res.status);
      }
      expect((await channelMemberIds()).has(dave.id)).toBe(false);
    });

    it('ручное исключение участника из канала проекта → отказ, состав не меняется', async () => {
      const res = await fx.api(
        alice,
        'DELETE',
        `/chat/conversations/${channelId}/members/${bob.id}`,
      );
      expect([400, 403, 422]).toContain(res.status);
      expect((await channelMemberIds()).has(bob.id)).toBe(true);
    });

    it('корневая отправка: без права публикации — 403, руководитель — 201', async () => {
      const denied = await fx.api(carol, 'POST', `/chat/conversations/${channelId}/messages`, {
        body: { text: 'Наблюдатель пишет в канал' },
        key: nextKey('send-denied'),
      });
      expect(denied.status).toBe(403);

      const allowed = await fx.api(bob, 'POST', `/chat/conversations/${channelId}/messages`, {
        body: { text: 'Пост помощника' },
        key: nextKey('send-manager'),
      });
      expect(allowed.status).toBe(201);
    });

    it('тред канала открыт участнику без права публикации', async () => {
      const res = await fx.api(carol, 'POST', `/chat/conversations/${channelId}/messages`, {
        body: { text: 'Ответ в треде', threadRootId: rootId },
        key: nextKey('thread-reply'),
      });
      expect(res.status).toBe(201);
    });

    it('корневая пересылка проверяет право публикации проекта, тред — нет', async () => {
      const denied = await fx.api(carol, 'POST', `/chat/conversations/${channelId}/forward`, {
        body: { sourceConversationId: channelId, messageIds: [rootId] },
        key: nextKey('fwd-denied'),
      });
      expect(denied.status).toBe(403);

      const allowed = await fx.api(alice, 'POST', `/chat/conversations/${channelId}/forward`, {
        body: { sourceConversationId: channelId, messageIds: [rootId] },
        key: nextKey('fwd-manager'),
      });
      expect(allowed.status).toBe(201);

      const thread = await fx.api(carol, 'POST', `/chat/conversations/${channelId}/forward`, {
        body: { sourceConversationId: channelId, messageIds: [rootId], threadRootId: rootId },
        key: nextKey('fwd-thread'),
      });
      expect(thread.status).toBe(201);
    });

    it('синхронизация из проекта убирает и возвращает участника канала', async () => {
      const removed = await fx.api(alice, 'DELETE', `/projects/${projectId}/members/${carol.id}`);
      expect(removed.status).toBe(200);
      await waitFor(async () => !(await channelMemberIds()).has(carol.id), 'channel without carol');

      const added = await fx.api(alice, 'POST', `/projects/${projectId}/members`, {
        body: { userId: carol.id, kind: 'observer' },
        key: nextKey('observer-back'),
      });
      expect(added.status).toBe(201);
      await waitFor(async () => (await channelMemberIds()).has(carol.id), 'channel with carol');
    });
  },
);
