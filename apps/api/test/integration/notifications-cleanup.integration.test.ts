import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAT_EVENTS, CORRESPONDENCE_EVENTS } from '@nodus/contracts';

import { TransactionRunner } from '../../src/core/database/transaction-runner.js';
import type { PrismaService } from '../../src/core/database/prisma.service.js';
import { EventBus } from '../../src/core/events/event-bus.js';
import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';

/**
 * AUD-011 на живом стеке: событие → подписчик notifications → строки журнала
 * удалены, счётчик «Требуют внимания» пересчитан, чужие строки не тронуты.
 * Исключение из беседы идёт штатным REST (событие публикует chat), удаление
 * письма моделируется публикацией контрактного события correspondence.*.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'notifications: чистка при потере доступа (AUD-011, integration)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
    let alice: ChatUser;
    let bob: ChatUser;
    let carol: ChatUser;
    let dispatcher: EventDispatcher;
    let prisma: PrismaService;

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob', 'carol']);
      ({ alice, bob, carol } = fx.users);
      dispatcher = fx.app.get(EventDispatcher);
      prisma = fx.prisma;
    }, 120_000);

    afterAll(async () => {
      await fx?.cleanup();
    });

    /** Строка журнала «как из конвейера»: источник задан, получатель — явно. */
    async function insertNotification(
      userId: string,
      sourceType: 'conversation' | 'letter',
      sourceId: string,
    ): Promise<void> {
      await prisma.notification.create({
        data: {
          userId,
          priority: 'high',
          kind: 'chat.direct_message',
          sourceType,
          sourceId,
          sourceSeq: 0n,
          preview: 'AUD-011',
          eventId: randomUUID(),
        },
      });
    }

    async function attention(user: ChatUser): Promise<number> {
      const res = await fx.api(user, 'GET', '/notifications/summary');
      expect(res.status).toBe(200);
      return ((await res.json()) as { attention: number }).attention;
    }

    it('chat.member_removed: у исключённого строки беседы уходят, у оставшихся — нет', async () => {
      const created = await fx.api(alice, 'POST', '/chat/conversations', {
        body: { type: 'group', title: `AUD011 ${fx.runId}`, memberIds: [bob.id, carol.id] },
        key: `aud011-group-${fx.runId}`,
      });
      expect(created.status).toBe(201);
      const conversationId = ((await created.json()) as { id: string }).id;

      await insertNotification(bob.id, 'conversation', conversationId);
      await insertNotification(carol.id, 'conversation', conversationId);
      const bobBefore = await attention(bob);

      const removed = await fx.api(
        alice,
        'DELETE',
        `/chat/conversations/${conversationId}/members/${bob.id}`,
        { key: `aud011-remove-${fx.runId}` },
      );
      expect(removed.status).toBe(204);
      await dispatchOwnEvent(
        dispatcher,
        prisma,
        await eventIdOf(prisma, {
          type: CHAT_EVENTS.MEMBER_REMOVED,
          aggregateId: conversationId,
        }),
      );

      expect(
        await prisma.notification.count({
          where: { userId: bob.id, sourceType: 'conversation', sourceId: conversationId },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { userId: carol.id, sourceType: 'conversation', sourceId: conversationId },
        }),
      ).toBe(1);
      expect(await attention(bob)).toBe(bobBefore - 1);

      // Бейдж исключённого синхронизирован штатным notification.read.
      expect(
        await prisma.event.count({
          where: { type: 'notification.read', aggregateId: bob.id },
        }),
      ).toBeGreaterThan(0);
    });

    it('correspondence.letter_deleted: уведомления письма уходят у всех, чужие письма целы', async () => {
      const letterId = randomUUID();
      const otherLetterId = randomUUID();
      await insertNotification(alice.id, 'letter', letterId);
      await insertNotification(carol.id, 'letter', letterId);
      await insertNotification(alice.id, 'letter', otherLetterId);
      const aliceBefore = await attention(alice);

      await new TransactionRunner(prisma).run(async (tx) => {
        await new EventBus().emit(
          tx,
          CORRESPONDENCE_EVENTS.LETTER_DELETED,
          { letterId },
          { actorId: alice.id, aggregateType: 'letter', aggregateId: letterId },
        );
      });
      await dispatchOwnEvent(
        dispatcher,
        prisma,
        await eventIdOf(prisma, {
          type: CORRESPONDENCE_EVENTS.LETTER_DELETED,
          aggregateId: letterId,
        }),
      );

      expect(
        await prisma.notification.count({
          where: { sourceType: 'letter', sourceId: letterId },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { sourceType: 'letter', sourceId: otherLetterId },
        }),
      ).toBe(1);
      // alice теряет строку удалённого письма, но сохраняет строку чужого.
      expect(await attention(alice)).toBe(aliceBefore - 1);
    });
  },
);
