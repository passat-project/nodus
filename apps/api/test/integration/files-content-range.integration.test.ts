import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Частичная отдача контента (#1005): живой HTTP + живой MinIO/SILO.
 * Браузер перематывает видео только когда сервер отвечает 206 + Content-Range
 * на байтовые диапазоны; 416 — вне файла; негодный Range игнорируется (200);
 * ETag-304 остаётся для запросов без Range, If-Range защищает от склейки
 * срезов разных версий.
 */

const SIZE = 4096;
const BYTES = Uint8Array.from({ length: SIZE }, (_, index) => index % 251);

describe.skipIf(!process.env.DATABASE_URL || !process.env.STORAGE_ACCESS_KEY)(
  'files: контент по Range/206 (integration, #1005)',
  () => {
    let fx: ChatTestFixture<'alice'>;
    let alice: ChatUser;
    let origin = '';
    let url = '';
    let attachmentId = '';
    let etag = '';

    beforeAll(async () => {
      fx = await setupChatFixture(['alice']);
      alice = fx.users.alice;
      origin = fx.baseUrl.replace(/\/api\/v1$/, '');

      const form = new FormData();
      form.append('size', String(SIZE));
      form.append('file', new Blob([BYTES], { type: 'video/mp4' }), 'clip.mp4');
      const uploaded = await fetch(`${fx.baseUrl}/chat/attachments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${alice.token}` },
        body: form,
      });
      expect(uploaded.status).toBe(201);
      const attachment = (await uploaded.json()) as {
        id: string;
        fileId: string;
        url: string;
        mime: string;
      };
      attachmentId = attachment.id;
      url = attachment.url;
      expect(attachment.mime).toBe('video/mp4');
    }, 120_000);

    afterAll(async () => {
      if (!fx) return;
      try {
        // Неотправленное вложение убирается штатной отменой (строка + объект).
        await fetch(`${fx.baseUrl}/chat/attachments/${attachmentId}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${alice.token}` },
        }).catch(() => undefined);
      } finally {
        await fx.cleanup();
      }
    });

    it('обычный GET: 200, Accept-Ranges, видео inline', async () => {
      const res = await fetch(`${origin}${url}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect(res.headers.get('content-disposition')).toContain('inline');
      // Security-ревью #1005: пользовательский контент — с CSP-песочницей.
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(res.headers.get('content-length')).toBe(String(SIZE));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
      etag = res.headers.get('etag') ?? '';
      expect(etag).toBeTruthy();
    });

    it('Range: bytes=0-99 — 206, точный срез и Content-Range', async () => {
      const res = await fetch(`${origin}${url}`, { headers: { range: 'bytes=0-99' } });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes 0-99/${SIZE}`);
      expect(res.headers.get('content-length')).toBe('100');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(0, 100));
    });

    it('Range: bytes=-16 — последние 16 байт', async () => {
      const res = await fetch(`${origin}${url}`, { headers: { range: 'bytes=-16' } });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes ${SIZE - 16}-${SIZE - 1}/${SIZE}`);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(-16));
    });

    it('Range за пределами файла — 416 единым конвертом + Content-Range', async () => {
      const res = await fetch(`${origin}${url}`, { headers: { range: `bytes=${SIZE}-` } });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
      const body = (await res.json()) as { code: string; traceId: string };
      expect(body.code).toBe(ErrorCode.FILE_RANGE_NOT_SATISFIABLE);
      expect(body.traceId).toBeTruthy();
    });

    it('негодный Range игнорируется — 200 и весь файл', async () => {
      const res = await fetch(`${origin}${url}`, { headers: { range: 'bytes=abc' } });
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    });

    it('If-Range: чужая версия — весь файл; своя — 206', async () => {
      const stale = await fetch(`${origin}${url}`, {
        headers: { range: 'bytes=0-9', 'if-range': '"other-version"' },
      });
      expect(stale.status).toBe(200);
      expect(new Uint8Array(await stale.arrayBuffer())).toEqual(BYTES);

      const fresh = await fetch(`${origin}${url}`, {
        headers: { range: 'bytes=0-9', 'if-range': etag },
      });
      expect(fresh.status).toBe(206);
      expect(new Uint8Array(await fresh.arrayBuffer())).toEqual(BYTES.slice(0, 10));
    });

    it('ETag-304 остаётся только для запросов без Range', async () => {
      const plain = await fetch(`${origin}${url}`, { headers: { 'if-none-match': etag } });
      expect(plain.status).toBe(304);

      const ranged = await fetch(`${origin}${url}`, {
        headers: { 'if-none-match': etag, range: 'bytes=0-9' },
      });
      expect(ranged.status).toBe(206);
    });
  },
);
