import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conversationVaultPageSchema,
  favoriteSourcesSchema,
  type ConversationVaultPage,
  type FavoriteSources,
} from '@nodus/contracts';

import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Витрина беседы #211 (integration): серверные списки категорий
 * image|video|audio|document|link со счётчиками, write-time проекция ссылок
 * и ИНВАРИАНТ денормализованных счётчиков (stats == фактический состав живых
 * сообщений) на всём цикле жизни: отправка → правка состава/текста →
 * удаление; скоуп треда, пагинация keyset, RBAC (не-участник 404);
 * источники «Избранного» (Ф3); видео/аудио — файлы по mime (ревизия 05.10).
 */

const IMAGE_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const FILE_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4]);

describe.skipIf(!process.env.DATABASE_URL || !process.env.STORAGE_ACCESS_KEY)(
  'chat: витрина беседы (#211, integration)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
    let alice: ChatUser;
    let bob: ChatUser;
    let carol: ChatUser;
    const fileIds: string[] = [];

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob', 'carol']);
      ({ alice, bob, carol } = fx.users);
    }, 120_000);

    afterAll(async () => {
      if (!fx) return;
      try {
        await fx.prisma.messageAttachment.deleteMany({
          where: { ownerId: { in: [alice.id, bob.id] } },
        });
        await fx.prisma.fileObject.deleteMany({
          where: { ownerId: { in: [alice.id, bob.id] } },
        });
      } finally {
        await fx.cleanup();
      }
    });

    function upload(user: ChatUser, bytes: Uint8Array, fileName: string, mime: string) {
      const form = new FormData();
      form.append('size', String(bytes.length));
      const blob = new Blob([bytes], { type: mime });
      form.append('file', blob, fileName);
      return fetch(`${fx.baseUrl}/chat/attachments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${user.token}` },
        body: form,
      });
    }

    async function makeConversation(): Promise<string> {
      const res = await fx.api(alice, 'POST', '/chat/conversations', {
        body: { type: 'group', title: `Витрина ${fx.runId}`, memberIds: [bob.id] },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    }

    async function send(
      user: ChatUser,
      conv: string,
      body: { text?: string; attachmentIds?: string[]; threadRootId?: string },
    ): Promise<string> {
      const res = await fx.api(user, 'POST', `/chat/conversations/${conv}/messages`, {
        body: { text: body.text ?? '', ...body },
        key: `vault-${fx.runId}-${Math.random().toString(36).slice(2)}`,
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    }

    async function vault(
      user: ChatUser,
      conv: string,
      query: string,
    ): Promise<{ status: number; page: ConversationVaultPage | null }> {
      const res = await fx.api(user, 'GET', `/chat/conversations/${conv}/attachments?${query}`);
      if (res.status !== 200) return { status: res.status, page: null };
      const json = (await res.json()) as unknown;
      return { status: 200, page: conversationVaultPageSchema.parse(json) };
    }

    it('отправка → списки и счётчики трёх типов; вложение вид вне окна ленты', async () => {
      const conv = await makeConversation();
      const image = await upload(alice, IMAGE_BYTES, 'foto.png', 'image/png');
      expect(image.status).toBe(201);
      const imageAttachment = (await image.json()) as { id: string };
      fileIds.push(imageAttachment.id);
      const doc = await upload(alice, FILE_BYTES, 'plan.pdf', 'application/pdf');
      expect(doc.status).toBe(201);
      const docAttachment = (await doc.json()) as { id: string };
      fileIds.push(docAttachment.id);

      await send(alice, conv, {
        text: 'Смотрите https://example.com/a и http://example.org/b.',
        attachmentIds: [imageAttachment.id, docAttachment.id],
      });
      await send(bob, conv, { text: 'Ещё ссылка https://example.com/c' });

      const media = await vault(alice, conv, 'type=image');
      expect(media.page!.items).toHaveLength(1);
      expect(media.page!.items[0]).toMatchObject({
        type: 'image',
        attachment: { name: 'foto.png', kind: 'image' },
        author: { id: alice.id },
      });
      expect(media.page!.counts).toEqual({ image: 1, video: 0, audio: 0, document: 1, link: 3 });

      const documents = await vault(alice, conv, 'type=document');
      expect(documents.page!.items[0]).toMatchObject({
        type: 'document',
        attachment: { name: 'plan.pdf' },
      });

      const links = await vault(alice, conv, 'type=link');
      expect(links.page!.items.map((i) => (i.type === 'link' ? i.url : null))).toEqual([
        'https://example.com/c',
        'https://example.com/a',
        'http://example.org/b',
      ]);
      // Хвостовая пунктуация срезана (точка предложения не часть адреса).
      expect(links.page!.items.every((i) => i.type !== 'link' || !/[.]$/.test(i.url))).toBe(true);
    });

    it('RBAC: не-участник — 404 (не раскрываем существование)', async () => {
      const res = await fx.api(
        carol,
        'GET',
        `/chat/conversations/${await makeConversation()}/attachments?type=image`,
      );
      expect(res.status).toBe(404);
    });

    it('правка текста: замена ссылок отражается в счётчике (Δ проекции)', async () => {
      const conv = await makeConversation();
      const messageId = await send(alice, conv, {
        text: 'Было https://old.example/x',
      });
      expect((await vault(alice, conv, 'type=link')).page!.counts.link).toBe(1);

      const res = await fx.api(
        alice,
        'PATCH',
        `/chat/conversations/${conv}/messages/${messageId}`,
        {
          body: { text: 'Стало https://new.example/y и https://new.example/z' },
        },
      );
      expect(res.status).toBe(200);
      const links = await vault(alice, conv, 'type=link');
      expect(links.page!.counts.link).toBe(2);
      // Внутри одного сообщения ссылки идут по позициям текста (ASC).
      expect(links.page!.items.map((i) => (i.type === 'link' ? i.url : null))).toEqual([
        'https://new.example/y',
        'https://new.example/z',
      ]);
    });

    it('удаление сообщения: состав гасится из списков и счётчиков', async () => {
      const conv = await makeConversation();
      const image = await upload(alice, IMAGE_BYTES, 'del.png', 'image/png');
      const attachment = (await image.json()) as { id: string };
      fileIds.push(attachment.id);
      // #250: видео — отдельный вид вложения; удаление обязано обнулить и его
      // (пересчёт по видам не должен «терять» kind='video').
      const video = await upload(alice, FILE_BYTES, 'del.mp4', 'video/mp4');
      const videoAttachment = (await video.json()) as { id: string };
      fileIds.push(videoAttachment.id);
      const messageId = await send(alice, conv, {
        text: 'https://gone.example/a',
        attachmentIds: [attachment.id, videoAttachment.id],
      });
      expect((await vault(alice, conv, 'type=image')).page!.counts).toEqual({
        image: 1,
        video: 1,
        audio: 0,
        document: 0,
        link: 1,
      });

      const res = await fx.api(
        alice,
        'DELETE',
        `/chat/conversations/${conv}/messages/${messageId}`,
      );
      expect([200, 204]).toContain(res.status);
      const media = await vault(alice, conv, 'type=image');
      expect(media.page!.items).toHaveLength(0);
      expect(media.page!.counts).toEqual({ image: 0, video: 0, audio: 0, document: 0, link: 0 });
    });

    it('пагинация keyset: страницы без потерь и дублей', async () => {
      const conv = await makeConversation();
      // Привязка вложения одноразовая (claim): три сообщения — три файла.
      for (let i = 0; i < 3; i += 1) {
        const image = await upload(alice, IMAGE_BYTES, `g${i}.png`, 'image/png');
        const attachment = (await image.json()) as { id: string };
        fileIds.push(attachment.id);
        await send(alice, conv, { attachmentIds: [attachment.id] });
      }
      const first = await vault(alice, conv, 'type=image&limit=2');
      expect(first.page!.items).toHaveLength(2);
      expect(first.page!.nextCursor).toBeTruthy();
      expect(first.page!.counts.image).toBe(3);
      const second = await vault(
        alice,
        conv,
        `type=image&limit=2&cursor=${first.page!.nextCursor}`,
      );
      expect(second.page!.items).toHaveLength(1);
      expect(second.page!.nextCursor).toBeNull();
      const ids = [...first.page!.items, ...second.page!.items].map((i) =>
        i.type === 'image' || i.type === 'document' ? i.attachment.id : '',
      );
      expect(new Set(ids).size).toBe(3);
    });

    it('скоуп треда: корень + ответы, счётчики на лету', async () => {
      const conv = await makeConversation();
      const image = await upload(alice, IMAGE_BYTES, 't.png', 'image/png');
      const attachment = (await image.json()) as { id: string };
      fileIds.push(attachment.id);
      const rootId = await send(alice, conv, {
        text: 'Корень https://root.example/a',
        attachmentIds: [attachment.id],
      });
      await send(bob, conv, { text: 'Ответ https://reply.example/b', threadRootId: rootId });

      const all = await vault(alice, conv, 'type=link');
      expect(all.page!.counts.link).toBe(2);
      const thread = await vault(alice, conv, `type=link&threadRootId=${rootId}`);
      expect(thread.page!.items.map((i) => (i.type === 'link' ? i.url : null))).toEqual([
        'https://reply.example/b',
        'https://root.example/a',
      ]);
      expect(thread.page!.counts).toEqual({ image: 1, video: 0, audio: 0, document: 0, link: 2 });
    });

    it('источники «Избранного»: чат-источник со счётчиком + «Записи»', async () => {
      const conv = await makeConversation();
      const star1 = await send(alice, conv, { text: 'Звёздное https://fav.example/a' });
      const star2 = await send(bob, conv, { text: 'Вторая звезда' });
      // Запись в «Избранном» alice (direct с собой) + звёзды.
      const notes = await fx.api(alice, 'POST', `/chat/conversations/direct/${alice.id}`);
      expect(notes.status).toBeLessThan(300);
      await send(alice, ((await notes.json()) as { id: string }).id, {
        text: 'Моя запись',
      });
      for (const messageId of [star1, star2]) {
        const res = await fx.api(alice, 'POST', '/chat/favorites', {
          body: { messageIds: [messageId] },
        });
        expect(res.status).toBe(200);
      }

      const res = await fx.api(alice, 'GET', '/chat/favorites/sources');
      expect(res.status).toBe(200);
      const sources = favoriteSourcesSchema.parse(await res.json()) as FavoriteSources;
      const fromConv = sources.sources.find((s) => s.conversationId === conv);
      expect(fromConv).toMatchObject({ count: 2, conversationType: 'group' });
      // Категории считают ЗВЁЗДЫ (карточки), не беседу «Избранное».
      expect(sources.counts).toEqual({
        image: 0,
        video: 0,
        audio: 0,
        document: 0,
        link: 1,
      });
      expect(sources.notes.count).toBe(1);
    });

    it('видео/аудио — файлы по mime (ревизия 05.10); счётчики — отдельный эндпоинт', async () => {
      const conv = await makeConversation();
      const video = await upload(alice, FILE_BYTES, 'briefing.mp4', 'video/mp4');
      const videoAttachment = (await video.json()) as { id: string };
      fileIds.push(videoAttachment.id);
      const audio = await upload(alice, FILE_BYTES, 'memo.m4a', 'audio/x-m4a');
      const audioAttachment = (await audio.json()) as { id: string };
      fileIds.push(audioAttachment.id);
      const doc = await upload(alice, FILE_BYTES, 'act.pdf', 'application/pdf');
      const docAttachment = (await doc.json()) as { id: string };
      fileIds.push(docAttachment.id);
      // Привязка вложения одноразовая и только своим владельцем — все три
      // файла уходят одним сообщением alice.
      await send(alice, conv, {
        attachmentIds: [videoAttachment.id, audioAttachment.id, docAttachment.id],
      });

      const countsUrl = `/chat/conversations/${conv}/attachments/counts`;
      const countsRes = await fx.api(alice, 'GET', countsUrl);
      expect(countsRes.status).toBe(200);
      expect(await countsRes.json()).toEqual({
        image: 0,
        video: 1,
        audio: 1,
        document: 1,
        link: 0,
      });

      const videos = await vault(alice, conv, 'type=video');
      expect(videos.page!.items).toHaveLength(1);
      expect(videos.page!.items[0]).toMatchObject({
        type: 'video',
        // #250: видео — явный вид вложения (не «файл с видео-mime»).
        attachment: { name: 'briefing.mp4', kind: 'video', durationMs: null },
      });
      const audios = await vault(alice, conv, 'type=audio');
      expect(audios.page!.items[0]).toMatchObject({
        type: 'audio',
        attachment: { name: 'memo.m4a' },
      });
      const documents = await vault(alice, conv, 'type=document');
      expect(documents.page!.items[0]).toMatchObject({
        type: 'document',
        attachment: { name: 'act.pdf' },
      });

      // Не-участник — 404 и на счётчиках.
      const carolCounts = await fx.api(carol, 'GET', countsUrl);
      expect(carolCounts.status).toBe(404);
    });
  },
);
