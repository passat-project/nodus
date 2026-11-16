import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatMessageSentPayloadSchema, ErrorCode } from '@nodus/contracts';

import { Prisma } from '../../src/generated/prisma/client.js';
import { DomainException } from '../../src/core/errors/domain-exception.js';
import { ConversationsService } from '../../src/modules/chat/conversations/conversations.service.js';
import { MessageActionsService } from '../../src/modules/chat/messages/message-actions.service.js';
import {
  MessagesService,
  type SendResult,
} from '../../src/modules/chat/messages/messages.service.js';
import { setupChatFixture, type ChatTestFixture } from './chat-fixtures.js';

/**
 * Гонки и гарантии надёжности (главный критерий приёмки #58): сообщения
 * корпоративного мессенджера не имеют права теряться или дублироваться.
 * Гонки — через сервисы напрямую: Redis-интерсептор идемпотентности стоит
 * выше сервиса в HTTP-пайплайне и замаскировал бы гонку на уровне БД.
 * Исключение — replay пересылки: он и есть контракт интерсептора (ADR-0005),
 * поэтому проверяется через HTTP, где интерсептор живёт.
 */

describe.skipIf(!process.env.DATABASE_URL)(
  'chat: надёжность — гонки и гарантии (integration)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob' | 'carol' | 'dave' | 'eve'>;
    let messages: MessagesService;
    let conversations: ConversationsService;
    let actions: MessageActionsService;
    let nextConv = 0;

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob', 'carol', 'dave', 'eve']);
      messages = fx.app.get(MessagesService);
      conversations = fx.app.get(ConversationsService);
      actions = fx.app.get(MessageActionsService);
    }, 120_000);

    afterAll(async () => {
      await fx?.cleanup();
    });

    async function makeGroup(): Promise<string> {
      nextConv += 1;
      const item = await conversations.create(fx.users.alice.id, {
        type: 'group',
        title: `Надёжность ${fx.runId}-${nextConv}`,
        memberIds: [fx.users.bob.id, fx.users.carol.id, fx.users.dave.id, fx.users.eve.id],
      });
      return item.id;
    }

    /** Причина отклонения в читаемом виде — иначе гонка падает без контекста. */
    function reasons(attempts: PromiseSettledResult<SendResult>[]): string {
      return attempts
        .flatMap((a) => (a.status === 'rejected' ? [String(a.reason)] : []))
        .join('; ');
    }

    it('гонка дубля: 10 параллельных отправок с одним client_message_id → ровно 1 строка', async () => {
      const conv = await makeGroup();
      const key = `race-dup-${fx.runId}`;
      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          messages.send(
            { id: fx.users.alice.id, permissions: [] },
            conv,
            { text: 'гонка дубля' },
            key,
          ),
        ),
      );
      expect(reasons(attempts)).toBe('');
      const fulfilled = attempts.filter((a) => a.status === 'fulfilled').map((a) => a.value);

      // Все вызовы вернули ОДИН и тот же id.
      expect(new Set(fulfilled.map((r) => r.message.id)).size).toBe(1);
      expect(fulfilled.some((r) => r.replayed)).toBe(true);

      // В БД ровно одна строка пары (author, client_message_id) и без дублей seq.
      const rows = await fx.prisma.message.findMany({ where: { conversationId: conv } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.clientMessageId).toBe(key);
      const sentEvents = await fx.prisma.event.findMany({
        where: { type: 'chat.message_sent', aggregateId: conv },
      });
      expect(sentEvents).toHaveLength(1); // outbox не задублирован
      expect(chatMessageSentPayloadSchema.parse(sentEvents[0]!.payload).messageId).toBe(
        rows[0]!.id,
      );
    });

    it('гонка 20 параллельных отправок от 5 пользователей: seq 1..20 без дыр и дублей', async () => {
      const conv = await makeGroup();
      const tags = ['alice', 'bob', 'carol', 'dave', 'eve'] as const;
      const sends: Promise<SendResult>[] = [];
      for (const tag of tags) {
        for (let i = 1; i <= 4; i += 1) {
          sends.push(
            messages.send(
              { id: fx.users[tag].id, permissions: [] },
              conv,
              { text: `${tag}-${i}` },
              `race-20-${fx.runId}-${tag}-${i}`,
            ),
          );
        }
      }
      const attempts = await Promise.allSettled(sends);
      expect(reasons(attempts)).toBe('');

      // Непрерывность seq: SELECT ... ORDER BY seq → ровно 1..20, по 4 на автора.
      const rows = await fx.prisma.message.findMany({
        where: { conversationId: conv },
        orderBy: { seq: 'asc' },
      });
      expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(rows.every((r) => r.threadRootId === null)).toBe(true);
      for (const tag of tags) {
        expect(rows.filter((r) => r.authorId === fx.users[tag].id)).toHaveLength(4);
      }

      // Пагинация по 3 покрывает все 20 без пропусков и дублей.
      const expectedIds = new Set(rows.map((r) => r.id));
      let cursor: string | null = null;
      const seen: string[] = [];
      let pages = 0;
      do {
        const page = await messages.list(fx.users.alice.id, conv, {
          limit: 3,
          ...(cursor ? { cursor } : {}),
        });
        pages += 1;
        seen.push(...page.items.map((m) => m.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(pages).toBe(7); // ceil(20/3), хвост без «дырки»
      expect(new Set(seen).size).toBe(20);
      expect(new Set(seen)).toEqual(expectedIds);
    });

    it('гонка find-or-create direct: 10 параллельных вызовов → ровно одна беседа', async () => {
      const { alice, bob } = fx.users;
      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () => conversations.findOrCreateDirect(alice.id, bob.id)),
      );
      const rejected = attempts.flatMap((a) => (a.status === 'rejected' ? [String(a.reason)] : []));
      expect(rejected).toEqual([]);
      const ids = new Set(
        attempts.filter((a) => a.status === 'fulfilled').map((a) => a.value.item.id),
      );
      expect(ids.size).toBe(1);
      const conversationId = [...ids][0]!;

      const pair = [alice.id, bob.id].sort();
      expect(
        await fx.prisma.conversation.count({
          where: { type: 'direct', userMin: pair[0], userMax: pair[1] },
        }),
      ).toBe(1);
      const members = await fx.prisma.conversationMember.findMany({
        where: { conversationId },
      });
      expect(new Set(members.map((m) => m.userId))).toEqual(new Set([alice.id, bob.id]));
      // Событие создания — ровно одно (победитель гонки).
      expect(
        await fx.prisma.event.count({
          where: { type: 'chat.conversation_created', aggregateId: conversationId },
        }),
      ).toBe(1);
    });

    it('атомарность outbox: событие фиксируется вместе с сообщением; сбой не оставляет следов', async () => {
      const conv = await makeGroup();
      const sentCount = () =>
        fx.prisma.event.count({ where: { type: 'chat.message_sent', aggregateId: conv } });
      expect(await sentCount()).toBe(0);

      // Успешная отправка: message_sent в той же транзакции (+1, не отложенно).
      await messages.send(
        { id: fx.users.alice.id, permissions: [] },
        conv,
        { text: 'атомарно' },
        `atomic-${fx.runId}`,
      );
      expect(await sentCount()).toBe(1);
      expect(await fx.prisma.message.count({ where: { conversationId: conv } })).toBe(1);

      // Неудачная отправка (корень треда из другой беседы): транзакция откатывается —
      // ни строки, ни события, выделенный seq возвращается (last_seq не растёт).
      const otherConv = await makeGroup();
      const foreignRoot = await messages.send(
        { id: fx.users.bob.id, permissions: [] },
        otherConv,
        { text: 'чужой корень' },
        `atomic-root-${fx.runId}`,
      );
      const before = {
        events: await fx.prisma.event.count({ where: { aggregateId: conv } }),
        lastSeq: Number(
          (await fx.prisma.conversation.findUniqueOrThrow({ where: { id: conv } })).lastSeq,
        ),
      };
      await expect(
        messages.send(
          { id: fx.users.alice.id, permissions: [] },
          conv,
          { text: 'сломано', threadRootId: foreignRoot.message.id },
          `atomic-fail-${fx.runId}`,
        ),
      ).rejects.toSatisfy((e) => e instanceof DomainException && e.code === ErrorCode.NOT_FOUND);
      expect(await fx.prisma.message.count({ where: { conversationId: conv } })).toBe(1);
      expect(await fx.prisma.event.count({ where: { aggregateId: conv } })).toBe(before.events);
      expect(
        Number((await fx.prisma.conversation.findUniqueOrThrow({ where: { id: conv } })).lastSeq),
      ).toBe(before.lastSeq);
    });

    it('курсор прочтения монотонен: stale-квитанция не откатывает watermark', async () => {
      const { alice, bob } = fx.users;
      const conv = (await conversations.findOrCreateDirect(alice.id, bob.id)).item.id;
      await messages.send(
        { id: alice.id, permissions: [] },
        conv,
        { text: 'первое' },
        `cursor-1-${fx.runId}`,
      );
      await messages.send(
        { id: alice.id, permissions: [] },
        conv,
        { text: 'второе' },
        `cursor-2-${fx.runId}`,
      );

      const lastReadSeq = async () => {
        const rows = await fx.prisma.$queryRaw<{ last_read_seq: bigint }[]>(
          Prisma.sql`SELECT last_read_seq FROM conversation_members
          WHERE conversation_id = ${conv}::uuid AND user_id = ${bob.id}::uuid`,
        );
        return Number(rows[0]!.last_read_seq);
      };

      // GET ленты курсор НЕ двигает (#102 р.2: просмотр = видимость, не выдача).
      await messages.list(bob.id, conv, { limit: 50 });
      expect(await lastReadSeq()).toBe(0);

      await messages.readConversation(bob.id, conv, 2); // квитанция до низа
      expect(await lastReadSeq()).toBe(2);

      // «Отставшее устройство» присылает старую квитанцию — GREATEST держит.
      await messages.readConversation(bob.id, conv, 1);
      expect(await lastReadSeq()).toBe(2);
    });

    it('правка → повторный unread у читателя → просмотр восстанавливает readAt', async () => {
      const { alice, bob } = fx.users;
      const conv = (await conversations.findOrCreateDirect(alice.id, bob.id)).item.id;
      const message = await messages.send(
        { id: alice.id, permissions: [] },
        conv,
        { text: 'черновик решения' },
        `edit-cycle-${fx.runId}`,
      );
      const seq = Number(message.message.seq);

      const readAtOf = async () => {
        const feed = await messages.list(alice.id, conv, { limit: 50 });
        return feed.items.find((m) => m.id === message.message.id)!.readAt;
      };

      await messages.readConversation(bob.id, conv, seq); // B просмотрел
      expect(await readAtOf()).not.toBeNull();

      await messages.edit(alice.id, conv, message.message.id, { text: 'финальное решение' });

      // У читателя сообщение снова непрочитано; галочка у автора снята.
      const listForBob = await conversations.list(bob.id, { limit: 100 });
      expect(listForBob.items.find((i) => i.id === conv)?.unreadCount).toBe(1);
      expect(await readAtOf()).toBeNull();

      // B повторно просматривает: unread гаснет, readAt восстановлен.
      await messages.readConversation(bob.id, conv, seq);
      const listAfter = await conversations.list(bob.id, { limit: 100 });
      expect(listAfter.items.find((i) => i.id === conv)?.unreadCount).toBe(0);
      expect(await readAtOf()).not.toBeNull();
    });

    it('идемпотентность пересылки: повтор с тем же ключом возвращает тот же набор id', async () => {
      const { alice } = fx.users;
      const src = await makeGroup();
      const dst = await makeGroup();
      const s1 = await messages.send(
        { id: alice.id, permissions: [] },
        src,
        { text: 'файл отчёта' },
        `fwd-src-1-${fx.runId}`,
      );
      const s2 = await messages.send(
        { id: alice.id, permissions: [] },
        src,
        { text: 'таблица' },
        `fwd-src-2-${fx.runId}`,
      );

      const path = `/chat/conversations/${dst}/forward`;
      const body = {
        sourceConversationId: src,
        messageIds: [s1.message.id, s2.message.id],
        comment: 'Взгляните',
      };
      const key = `fwd-replay-${fx.runId}`;
      const first = await fx.api(alice, 'POST', path, { body, key });
      expect(first.status).toBe(201);
      const firstIds = ((await first.json()) as { id: string }[]).map((m) => m.id);

      // Ответ интерсептор кладёт в Redis асинхронно (tap) — ждём появления ключа.
      for (let waited = 0; waited < 5000; waited += 100) {
        if ((await fx.redis.keys(`nodus:core:idempotency:*${fx.runId}*`)).length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const second = await fx.api(alice, 'POST', path, { body, key });
      expect(second.status).toBe(201);
      expect(second.headers.get('idempotent-replay')).toBe('true');
      expect(((await second.json()) as { id: string }[]).map((m) => m.id)).toEqual(firstIds);

      // Копий ровно 3: комментарий + две, дублирования нет.
      expect(await fx.prisma.message.count({ where: { conversationId: dst } })).toBe(3);

      // Сет безопасности БД: тот же ключ напрямую в сервис (минуя Redis-реплей,
      // crash-окно между коммитом и записью ответа) — replay по (author,
      // client_message_id): те же строки, копий не прибавилось (#317).
      const replay = await actions.forward({ id: alice.id, permissions: [] }, dst, body, key);
      expect(replay.rows.map((r) => r.id)).toEqual(firstIds);
      expect(await fx.prisma.message.count({ where: { conversationId: dst } })).toBe(3);
    });

    it('уникальность (author_id, client_message_id) на уровне БД → P2002', async () => {
      const conv = await makeGroup();
      const key = `p2002-${fx.runId}`;
      const sent = await messages.send(
        { id: fx.users.alice.id, permissions: [] },
        conv,
        { text: 'оригинал' },
        key,
      );

      await expect(
        fx.prisma.message.create({
          data: {
            conversationId: conv,
            seq: sent.message.seq + 1n,
            authorId: fx.users.alice.id,
            clientMessageId: key, // тот же — уникальный индекс обязан остановить
            text: 'дубль напрямую',
          },
        }),
      ).rejects.toSatisfy(
        (e) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002',
      );
      expect(await fx.prisma.message.count({ where: { conversationId: conv } })).toBe(1);
    });
  },
);
