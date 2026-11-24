import { writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  buildVideoPoster,
  posterPositionSeconds,
  resolveVideoBinaries,
  runTool,
  type VideoTools,
} from './video-thumbnail.js';

/** #250: конвейер постера без реального ffmpeg — запуск бинарей инжектится,
 *  поэтому unit-тесты не зависят от установленного ffmpeg (интеграционный
 *  тест `chat-video-poster` гоняет настоящий). */

const PROBE_JSON = JSON.stringify({
  streams: [{ codec_type: 'video', width: 1280, height: 720 }],
  format: { duration: '12.345' },
});

function tools(
  run: VideoTools['run'],
  bins: Partial<Pick<VideoTools, 'ffmpeg' | 'ffprobe'>> = {},
): VideoTools {
  return { ffmpeg: bins.ffmpeg ?? 'ffmpeg', ffprobe: bins.ffprobe ?? 'ffprobe', run };
}

/** Фейковый ffmpeg «пишет» файл в последний аргумент (output). */
function runWritingPoster(poster: Buffer, probeStdout: string = PROBE_JSON): VideoTools['run'] {
  return vi.fn(async (bin, args) => {
    if (bin === 'ffprobe') return { stdout: probeStdout, stderr: '' };
    writeFileSync(args[args.length - 1]!, poster);
    return { stdout: '', stderr: '' };
  });
}

describe('resolveVideoBinaries — пути бинарей (#250)', () => {
  it('по умолчанию — PATH', () => {
    expect(resolveVideoBinaries({})).toEqual({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
  });

  it('FFMPEG_PATH/FFPROBE_PATH переопределяют (хост-контур)', () => {
    expect(
      resolveVideoBinaries({
        FFMPEG_PATH: ' D:/tools/ffmpeg.exe ',
        FFPROBE_PATH: 'D:/tools/ffprobe.exe',
      }),
    ).toEqual({ ffmpeg: 'D:/tools/ffmpeg.exe', ffprobe: 'D:/tools/ffprobe.exe' });
  });
});

describe('runTool — запуск без shell и потолки (#250)', () => {
  it('успех: stdout собирается', async () => {
    const result = await runTool(process.execPath, ['-e', "process.stdout.write('ok')"], 5_000);
    expect(result.stdout).toBe('ok');
  });

  it('ненулевой код — отказ с хвостом stderr', async () => {
    await expect(
      runTool(process.execPath, ['-e', "process.stderr.write('boom'); process.exit(3)"], 5_000),
    ).rejects.toThrow(/код 3.*boom/s);
  });

  it('зависший процесс добивается по таймауту', async () => {
    await expect(
      runTool(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], 200),
    ).rejects.toThrow(/timeout 200 мс/);
  });

  it('несуществующий бинарь — отказ spawn', async () => {
    await expect(runTool('nodus-definitely-no-such-binary', ['-version'], 5_000)).rejects.toThrow();
  });

  it('гигантский stdout обрезается предохранителем', async () => {
    await expect(
      runTool(
        process.execPath,
        ['-e', "process.stdout.write('x'.repeat(5 * 1024 * 1024))"],
        10_000,
      ),
    ).rejects.toThrow(/слишком большой вывод/);
  });
});

describe('buildVideoPoster — постер из стрима (#250)', () => {
  it('проба → кадр 10% длительности с thumbnail=n=40 → WebP ≤800', async () => {
    const run = runWritingPoster(Buffer.from('RIFF0000WEBP'));
    const result = await buildVideoPoster(Readable.from([Buffer.from('video-bytes')]), tools(run));

    expect(result).toEqual({
      width: 1280,
      height: 720,
      durationMs: 12_345,
      poster: Buffer.from('RIFF0000WEBP'),
    });
    const calls = vi.mocked(run).mock.calls;
    expect(calls[0]?.[0]).toBe('ffprobe');
    expect(calls[0]?.[1]).toContain('-show_format');
    expect(calls[0]?.[1]?.at(-1)).toMatch(/input\.bin$/);
    expect(calls[1]?.[0]).toBe('ffmpeg');
    const ffmpeg = calls[1]?.[1] ?? [];
    expect(ffmpeg[ffmpeg.indexOf('-ss') + 1]).toBe(String(posterPositionSeconds(12_345)));
    expect(ffmpeg).toContain(
      'thumbnail=n=40,scale=w=800:h=-2:force_original_aspect_ratio=decrease',
    );
  });

  it('ffprobe вернул не JSON — постера нет (тихий null)', async () => {
    const run = runWritingPoster(Buffer.from('x'), 'not-json');
    await expect(buildVideoPoster(Readable.from(['v']), tools(run))).resolves.toBeNull();
  });

  it('файл без видеопотока — постера нет', async () => {
    const run = runWritingPoster(Buffer.from('x'), JSON.stringify({ streams: [] }));
    await expect(buildVideoPoster(Readable.from(['v']), tools(run))).resolves.toBeNull();
  });

  it('ffmpeg оставил пустой файл — постера нет', async () => {
    const run = runWritingPoster(Buffer.alloc(0));
    await expect(buildVideoPoster(Readable.from(['v']), tools(run))).resolves.toBeNull();
  });

  it('сбой ffprobe — ошибка наружу (вызывающий логирует и ретраит job)', async () => {
    const run = vi.fn(async () => {
      throw new Error('ffprobe: код 1: broken');
    });
    await expect(buildVideoPoster(Readable.from(['v']), tools(run))).rejects.toThrow(
      /ffprobe: код 1/,
    );
  });
});
