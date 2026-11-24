import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Видео в чате (#250): загрузка → фоновая очередь (ffprobe-метаданные
 * авторитетно, с поворотом; постер-WebP через ffmpeg) → витрина/событие
 * привозят durationMs и постер. Гоняется только там, где есть ffmpeg/ffprobe
 * (CI ubuntu и dev-хост с FFMPEG_PATH/FFPROBE_PATH).
 */
const FFMPEG = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH?.trim() || 'ffprobe';
const ffmpegReady =
  spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync(FFPROBE, ['-version'], { stdio: 'ignore' }).status === 0;

interface UploadedVideo {
  id: string;
  kind: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  url: string;
}

interface VaultVideo {
  type: string;
  attachment: {
    id: string;
    kind: string;
    durationMs?: number | null;
    width: number | null;
    height: number | null;
    thumbnailUrl: string | null;
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!ffmpegReady || !process.env.DATABASE_URL || !process.env.STORAGE_ACCESS_KEY)(
  'chat: видео-постер и метаданные (integration, #250)',
  () => {
    let fx: ChatTestFixture<'alice'>;
    let alice: ChatUser;
    let origin = '';
    let attachmentId = '';
    let workDir = '';
    let dto: UploadedVideo;
    let processed: VaultVideo['attachment'];
    let thumbStatus = 0;
    let thumbType = '';
    let thumbBytes = new Uint8Array();

    beforeAll(async () => {
      fx = await setupChatFixture(['alice']);
      alice = fx.users.alice;
      origin = fx.baseUrl.replace(/\/api\/v1$/, '');
      workDir = mkdtempSync(path.join(tmpdir(), 'nodus-video-it-'));
      const videoPath = path.join(workDir, 'clip.mp4');
      const made = spawnSync(
        FFMPEG,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=320x240:rate=10:duration=2',
          '-pix_fmt',
          'yuv420p',
          '-c:v',
          'libx264',
          '-f',
          'mp4',
          videoPath,
        ],
        { stdio: 'ignore' },
      );
      expect(made.status, 'ffmpeg должен сгенерировать тестовый ролик').toBe(0);
      const bytes = readFileSync(videoPath);

      const form = new FormData();
      form.append('size', String(bytes.length));
      // Клиент «врёт» о длительности — сервер обязан взять ffprobe (авторитетно).
      form.append('durationMs', '1000');
      form.append('width', '320');
      form.append('height', '240');
      form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'clip.mp4');
      const uploaded = await fetch(`${fx.baseUrl}/chat/attachments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${alice.token}` },
        body: form,
      });
      expect(uploaded.status).toBe(201);
      dto = (await uploaded.json()) as UploadedVideo;
      attachmentId = dto.id;

      // Видео всегда в очереди (security #250): в ответе загрузки постера и
      // авторитетной длительности ещё нет — привязываем к сообщению и ждём
      // результат конвейера в витрине (событие патчит ленту тем же DTO).
      const convRes = await fx.api(alice, 'POST', '/chat/conversations', {
        body: { type: 'group', title: `Видео #250 ${fx.runId}`, memberIds: [] },
        key: `video-poster-conv-${fx.runId}`,
      });
      expect(convRes.status).toBe(201);
      const conversationId = ((await convRes.json()) as { id: string }).id;
      const sent = await fx.api(alice, 'POST', `/chat/conversations/${conversationId}/messages`, {
        body: { text: '', attachmentIds: [dto.id] },
        key: `video-poster-msg-${fx.runId}`,
      });
      expect(sent.status).toBe(201);

      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const vault = await fx.api(
          alice,
          'GET',
          `/chat/conversations/${conversationId}/attachments?type=video`,
        );
        if (vault.status === 200) {
          const page = (await vault.json()) as { items: VaultVideo[] };
          const item = page.items.find((entry) => entry.attachment.id === dto.id);
          if (item && item.attachment.thumbnailUrl && (item.attachment.durationMs ?? 0) > 1500) {
            processed = item.attachment;
            break;
          }
        }
        await sleep(300);
      }
      expect(processed, 'конвейер видео не довёл метаданные/постер за 45 с').toBeTruthy();

      const thumb = await fetch(`${origin}${processed.thumbnailUrl ?? ''}`);
      thumbStatus = thumb.status;
      thumbType = thumb.headers.get('content-type') ?? '';
      thumbBytes = new Uint8Array(await thumb.arrayBuffer());
    }, 120_000);

    it('kind=video, ffprobe перезаписал клиентскую длительность, постер — WebP', () => {
      expect(dto.kind).toBe('video');
      // До очереди DTO несёт клиентскую подсказку, а не авторитетное значение.
      expect(dto.durationMs).toBe(1000);
      expect(processed.kind).toBe('video');
      expect(processed.durationMs).toBeGreaterThan(1500);
      expect(processed.width).toBe(320);
      expect(processed.height).toBe(240);
      expect(processed.thumbnailUrl).toBeTruthy();
      expect(thumbStatus).toBe(200);
      expect(thumbType).toBe('image/webp');
      // RIFF....WEBP
      expect(String.fromCharCode(...thumbBytes.slice(0, 4))).toBe('RIFF');
      expect(String.fromCharCode(...thumbBytes.slice(8, 12))).toBe('WEBP');
    });

    afterAll(async () => {
      if (!fx) return;
      try {
        await fetch(`${fx.baseUrl}/chat/attachments/${attachmentId}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${alice.token}` },
        }).catch(() => undefined);
      } finally {
        if (workDir) rmSync(workDir, { recursive: true, force: true });
        await fx.cleanup();
      }
    });
  },
);
