import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, messageSchema, type ChatMessage } from '@nodus/contracts';

import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Контракт вложений чата на живом HTTP + живом MinIO (критерий приёмки #57):
 * upload (multipart-стрим) → отправка с attachmentIds → лента с подписанным
 * url → скачивание контента; подпись/карантин/лимиты/отмена.
 */

const IMAGE_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe.skipIf(!process.env.DATABASE_URL || !process.env.STORAGE_ACCESS_KEY)(
  'chat: вложения + файловое хранилище (integration, #57)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob'>;
    let alice: ChatUser;
    let bob: ChatUser;
    let origin = '';
    const fileIds: string[] = [];

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob']);
      ({ alice, bob } = fx.users);
      // Подписанный url уже содержит /api/v1 — ходим от origin приложения.
      origin = fx.baseUrl.replace(/\/api\/v1$/, '');
    }, 120_000);

    afterAll(async () => {
      if (!fx) return;
      try {
        // file_objects/message_attachments — без FK на users: убираем по владельцу.
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

    function upload(
      user: ChatUser,
      file: Blob,
      fields: Record<string, string>,
      fileName = 'foto.png',
    ): Promise<Response> {
      const form = new FormData();
      // Контрольный порядок контракта: текстовые поля ДО файловой части —
      // parts()/file() @fastify/multipart видят только их (репро #57: на
      // больших телах поля после файла терялись → size NaN → 400).
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      form.append('file', file, fileName);
      return fetch(`${fx.baseUrl}/chat/attachments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${user.token}` },
        body: form,
      });
    }

    /** fileId из подписанного url (контракт гарантирует url у живого вложения). */
    function fileIdOf(attachment: ChatMessage['attachments'][number]): string {
      const url = attachment.url ?? '';
      const id = url.split('/')[4] ?? '';
      expect(id, `unexpected url: ${url}`).toMatch(/^[0-9a-f-]{36}$/);
      return id;
    }

    async function makeConversation(): Promise<string> {
      const res = await fx.api(alice, 'POST', '/chat/conversations', {
        body: { type: 'group', title: `Вложения ${fx.runId}`, memberIds: [bob.id] },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    }

    it('upload → отправка → лента: url подписан, контент скачивается байт-в-байт', async () => {
      const conv = await makeConversation();
      const blob = new Blob([IMAGE_BYTES], { type: 'image/png' });
      const res = await upload(alice, blob, {
        size: String(IMAGE_BYTES.length),
        width: '2',
        height: '2',
      });
      expect(res.status).toBe(201);
      const attachment = (await res.json()) as ChatMessage['attachments'][number];
      expect(attachment.kind).toBe('image');
      expect(attachment.width).toBe(2);
      expect(attachment.url).toMatch(
        /^\/api\/v1\/files\/[^/]+\/content\?exp=\d+&sig=[0-9a-f]{64}$/,
      );
      fileIds.push(fileIdOf(attachment));

      const sent = await fx.api(alice, 'POST', `/chat/conversations/${conv}/messages`, {
        body: { text: '', attachmentIds: [attachment.id] },
      });
      expect(sent.status).toBe(201);
      const dto = messageSchema.parse(await sent.json());
      expect(dto.attachments).toHaveLength(1);
      expect(dto.attachments[0]?.url).toBe(attachment.url);

      // Скачивание: ссылка без Authorization (как <img>) — байты совпадают,
      // изображение — inline, файл — attachment (Content-Disposition).
      const download = await fetch(`${origin}${attachment.url}`);
      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(IMAGE_BYTES);
      expect(download.headers.get('content-type')).toBe('image/png');
      expect(download.headers.get('content-disposition')).toContain('inline');
      expect(download.headers.get('etag')).toBeTruthy();

      // ETag-ревалидация: If-None-Match → 304 без перекачки.
      const etag = download.headers.get('etag') as string;
      const revalidated = await fetch(`${origin}${attachment.url}`, {
        headers: { 'if-none-match': etag },
      });
      expect(revalidated.status).toBe(304);

      // Второй участник видит то же вложение в ленте (права — при выдаче).
      const feedRes = await fx.api(bob, 'GET', `/chat/conversations/${conv}/messages?limit=50`);
      const feed = (await feedRes.json()) as { items: ChatMessage[] };
      expect(feed.items.at(-1)?.attachments[0]?.url).toBe(attachment.url);
    });

    it('большой файл (3 МБ) проходит — регресс полей-после-файла (репро #57)', async () => {
      const bytes = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(3 * 1024 * 1024, 7),
      ]);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const res = await upload(alice, blob, { size: String(bytes.length) }, 'big.jpg');
      expect(res.status).toBe(201);
      const attachment = (await res.json()) as ChatMessage['attachments'][number];
      expect(attachment.size).toBe(bytes.length);
      expect(attachment.kind).toBe('image');
      fileIds.push(fileIdOf(attachment));
    });

    it('файл > 64 МиБ: multipart-путь хранилища — регресс политики (#713)', async () => {
      // Порог partSize клиента хранилища (64 МиБ): выше него загрузка идёт
      // multipart-путём, а он перед стартом вызывает ListMultipartUploads
      // (findUploadId) и ListParts. Политика учётки без этих действий даёт
      // Access Denied → 400 FILE_SIZE_MISMATCH, хотя лимит приложения 100 МБ:
      // ровно так файл 86 МиБ не загружался на проде (issue #713).
      const size = 64 * 1024 * 1024 + 1;
      const bytes = Buffer.alloc(size, 7);
      const res = await upload(alice, new Blob([bytes]), { size: String(size) }, 'big.bin');
      expect(res.status).toBe(201);
      const attachment = (await res.json()) as ChatMessage['attachments'][number];
      expect(attachment.size).toBe(size);
      fileIds.push(fileIdOf(attachment));

      // Байт-в-байт из хранилища: обрезанный объект не должен отдаваться.
      const content = await fetch(`${origin}${attachment.url}`);
      expect(content.status).toBe(200);
      expect(Number(content.headers.get('content-length'))).toBe(size);
      expect((await content.arrayBuffer()).byteLength).toBe(size);

      // 64 МиБ в тест-бакете не оставляем: отмена неотправленного вложения
      // удаляет и строку, и объект хранилища (файл после проверки не нужен).
      const cancelled = await fx.api(alice, 'DELETE', `/chat/attachments/${attachment.id}`);
      expect(cancelled.status).toBe(204);
    });

    it('подпись: чужая/битая/просроченная — 401 единым конвертом', async () => {
      const blob = new Blob([IMAGE_BYTES], { type: 'image/png' });
      const res = await upload(alice, blob, { size: String(IMAGE_BYTES.length) });
      expect(res.status).toBe(201);
      const attachment = (await res.json()) as ChatMessage['attachments'][number];
      const id = fileIdOf(attachment);
      fileIds.push(id);

      const badSig = await fetch(
        `${origin}/api/v1/files/${id}/content?exp=9999999999&sig=${'a'.repeat(64)}`,
      );
      expect(badSig.status).toBe(401);
      const body = (await badSig.json()) as { code: string; traceId: string };
      expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
      expect(body.traceId).toBeTruthy();

      const expired = (attachment.url ?? '').replace(/exp=\d+/, 'exp=1000000000');
      const stale = await fetch(`${origin}${expired}`);
      expect(stale.status).toBe(401);
    });

    it('карантин: scan_status=infected не отдаётся (410 FILE_QUARANTINED)', async () => {
      const blob = new Blob([IMAGE_BYTES], { type: 'image/png' });
      const res = await upload(alice, blob, { size: String(IMAGE_BYTES.length) });
      const attachment = (await res.json()) as ChatMessage['attachments'][number];
      const id = fileIdOf(attachment);
      fileIds.push(id);

      await fx.prisma.fileObject.update({ where: { id }, data: { scanStatus: 'infected' } });
      const blocked = await fetch(`${origin}${attachment.url}`);
      expect(blocked.status).toBe(410);
      expect(((await blocked.json()) as { code: string }).code).toBe(ErrorCode.FILE_QUARANTINED);
    });

    it('SVG не отдаётся inline (stored-XSS, валидация #57): attachment + nosniff', async () => {
      const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'], {
        type: 'image/svg+xml',
      });
      const res = await upload(alice, svg, { size: String(svg.size) }, 'evil.svg');
      expect(res.status).toBe(201);
      const attachment = (await res.json()) as ChatMessage['attachments'][number];
      fileIds.push(fileIdOf(attachment));

      const fetched = await fetch(`${origin}${attachment.url}`);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get('content-disposition')).toContain('attachment');
      expect(fetched.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('лимиты: заявленный размер > 100 МБ — 413 до касания хранилища', async () => {
      const blob = new Blob([IMAGE_BYTES], { type: 'image/png' });
      const res = await upload(alice, blob, { size: String(100 * 1024 * 1024 + 1) });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { code: string }).code).toBe(
        ErrorCode.CHAT_ATTACHMENT_TOO_LARGE,
      );
    });

    it('несовпадение размера: заявлено больше, чем пришло — FILE_SIZE_MISMATCH', async () => {
      const blob = new Blob([IMAGE_BYTES], { type: 'image/png' });
      const res = await upload(alice, blob, { size: String(IMAGE_BYTES.length + 5) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe(ErrorCode.FILE_SIZE_MISMATCH);
    });

    it('отмена: DELETE неотправленного — 204, повторная отправка его не находит', async () => {
      const blob = new Blob([IMAGE_BYTES], { type: 'image/png' });
      const res = await upload(alice, blob, { size: String(IMAGE_BYTES.length) });
      const attachment = (await res.json()) as ChatMessage['attachments'][number];
      fileIds.push(fileIdOf(attachment));

      const cancelled = await fx.api(alice, 'DELETE', `/chat/attachments/${attachment.id}`);
      expect(cancelled.status).toBe(204);

      // Привязка отменённого молча пропускается (канон claimAttachments).
      const conv = await makeConversation();
      const sent = await fx.api(alice, 'POST', `/chat/conversations/${conv}/messages`, {
        body: { text: 'без вложения', attachmentIds: [attachment.id] },
      });
      expect(sent.status).toBe(201);
      const dto = messageSchema.parse(await sent.json());
      expect(dto.attachments).toHaveLength(0);
    });
  },
);
