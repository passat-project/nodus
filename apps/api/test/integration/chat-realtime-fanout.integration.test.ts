import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DOMAIN_EVENTS_STREAM,
  chatMessageSentPayloadSchema,
  messageSchema,
  realtimeEnvelopeSchema,
  type RealtimeEnvelope,
} from '@nodus/contracts';

import { RedisStreamPublisher } from '../../src/core/events/redis-stream-publisher.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Realtime-фанут #104 на живом стеке: REST-отправка сообщения → outbox-строка
 * → RedisStreamPublisher публикует envelope в Redis Stream `nodus:domain:events`
 * (консьюмер — WS-gateway). Проверяются контракт envelope, монотонность seq
 * и полнота (последнее событие батча доходит).
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'chat: realtime fanout → Redis Stream (integration)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob'>;
    let alice: ChatUser;
    let bob: ChatUser;
    let publisher: RedisStreamPublisher;
    const publishedIds: string[] = [];

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob']);
      ({ alice, bob } = fx.users);
      publisher = fx.app.get(RedisStreamPublisher);
    }, 120_000);

    afterAll(async () => {
      // Вежливая уборка стрима: тестовые envelope не копятся в общем хвосте.
      for (const id of publishedIds) {
        await fx?.redis.xdel(DOMAIN_EVENTS_STREAM, id);
      }
      await fx?.cleanup();
    });

    /** Найти в стриме envelope события message_sent для конкретного сообщения.
     *  Курсорный обход (стрим общий с dev-контуром и длинный после нагрузок);
     *  записи соседних контуров с неполным payload пропускаются молча. */
    async function findSentEnvelope(
      messageId: string,
    ): Promise<{ id: string; envelope: RealtimeEnvelope } | null> {
      let cursor = '-';
      for (;;) {
        const batch = (await fx.redis.xrange(DOMAIN_EVENTS_STREAM, cursor, '+', 'COUNT', 200)) as [
          string,
          string[],
        ][];
        if (batch.length === 0) {
          return null;
        }
        for (const [id, fields] of batch) {
          const raw = fields[fields.indexOf('envelope') + 1];
          if (!raw) continue;
          const envelope = realtimeEnvelopeSchema.parse(JSON.parse(raw));
          if (envelope.type !== 'chat.message_sent') continue;
          const payload = chatMessageSentPayloadSchema.safeParse(envelope.payload);
          if (payload.success && payload.data.messageId === messageId) {
            return { id, envelope };
          }
        }
        const lastId = batch[batch.length - 1]![0];
        if (batch.length < 200) {
          return null;
        }
        cursor = `(${lastId}`;
      }
    }

    it('отправка сообщения публикует контрактный envelope с монотонным seq', async () => {
      const res = await fx.api(alice, 'POST', '/chat/conversations', {
        body: { type: 'group', title: `Fanout ${fx.runId}`, memberIds: [bob.id] },
      });
      expect(res.status).toBe(201);
      const conversationId = ((await res.json()) as { id: string }).id;

      const first = messageSchema.parse(
        await (
          await fx.api(alice, 'POST', `/chat/conversations/${conversationId}/messages`, {
            body: { text: 'первое fanout-сообщение' },
            key: `fanout-1-${fx.runId}`,
          })
        ).json(),
      );
      const second = messageSchema.parse(
        await (
          await fx.api(alice, 'POST', `/chat/conversations/${conversationId}/messages`, {
            body: { text: 'второе fanout-сообщение' },
            key: `fanout-2-${fx.runId}`,
          })
        ).json(),
      );

      // Флэйк-иммунитет («expected null not to be null» в CI): корень —
      // ручной publishPending был no-op, пока фоновый поллер держал замок
      // (исправлено в издателе, #358: параллельный вызов ждёт и делает свой
      // проход). Цикл остаётся на длинный хвост outbox (батч LIMIT 200 кладёт
      // наши события не с первого прохода); в норме хватает одного прохода.
      let found1: { id: string; envelope: RealtimeEnvelope } | null = null;
      let found2: { id: string; envelope: RealtimeEnvelope } | null = null;
      for (let attempt = 0; attempt < 50 && !(found1 && found2); attempt++) {
        await publisher.publishPending();
        if (!found1) found1 = await findSentEnvelope(first.id);
        if (!found2) found2 = await findSentEnvelope(second.id);
        if (!(found1 && found2)) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(found1).not.toBeNull();
      expect(found2).not.toBeNull();
      publishedIds.push(found1!.id, found2!.id);

      const payload1 = chatMessageSentPayloadSchema.parse(found1!.envelope.payload);
      expect(payload1.conversationId).toBe(conversationId);
      expect(payload1.authorId).toBe(alice.id);
      expect(found1!.envelope.seq).toBeGreaterThan(0);
      expect(found2!.envelope.seq).toBeGreaterThan(found1!.envelope.seq);
      expect(found1!.envelope.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Автор действия — в envelope живьём (из events.actor_id): клиент гасит
      // им эхо своей мутации, а правку коллеги пропускает (#1051).
      expect(found1!.envelope.actorId).toBe(alice.id);
      expect(found2!.envelope.actorId).toBe(alice.id);
    });
  },
);
