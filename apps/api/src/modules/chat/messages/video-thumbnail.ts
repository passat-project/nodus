import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { parseVideoProbe, type VideoProbe } from './video-probe.js';

/** Максимальная сторона постера (WebP): ленты/галереи ≤800, как у фото. */
export const VIDEO_POSTER_MAX_EDGE = 800;

const PROBE_TIMEOUT_MS = 10_000;
const POSTER_TIMEOUT_MS = 30_000;
/** Постер — 10% длительности, но не позже 30 с: почти все ролики открываются
 *  затемнением/заставкой, кадр 0 всегда чёрный (#250, research 07.10). */
const POSTER_POSITION_RATIO = 0.1;
const POSTER_POSITION_MAX_SECONDS = 30;
const STDOUT_CAP_BYTES = 4 * 1024 * 1024;
const STDERR_KEEP_CHARS = 2_000;

export interface VideoPosterResult extends VideoProbe {
  poster: Buffer;
}

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

function ffprobeBin(): string {
  return process.env.FFPROBE_PATH?.trim() || 'ffprobe';
}

/** Запуск внешнего бинаря без shell: аргументы — массив (никаких инъекций),
 *  потолок времени + добивка SIGKILL (ffmpeg умеет висеть на stalled-read). */
function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: { stdout: string; stderr: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result ?? { stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${path.basename(bin)}: timeout ${timeoutMs} мс`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > STDOUT_CAP_BYTES) {
        child.kill('SIGKILL');
        finish(new Error(`${path.basename(bin)}: слишком большой вывод`));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-STDERR_KEEP_CHARS);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish(undefined, { stdout, stderr });
      else finish(new Error(`${path.basename(bin)}: код ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Позиция кадра для постера (сек): ~10% длительности, не позже 30 с. */
export function posterPositionSeconds(durationMs: number | null): number {
  const seconds = (durationMs ?? 5_000) / 1000;
  return Math.min(Math.max(seconds * POSTER_POSITION_RATIO, 0.1), POSTER_POSITION_MAX_SECONDS);
}

/**
 * Постер видео (#250): стрим из хранилища → временный файл (ffmpeg требует
 * seekable вход) → ffprobe (габариты с поворотом, длительность) → кадр
 * `thumbnail=n=40` (репрезентативный, а не чёрный первый) → WebP ≤800.
 *
 * Возвращает null, если файл не видео/не читается (постер опционален —
 * плитка живёт на клиентских метаданных и заглушке). Броски ffmpeg/IO —
 * наружу, вызывающий логирует и оставляет thumbFileId=null.
 */
export async function buildVideoPoster(stream: Readable): Promise<VideoPosterResult | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nodus-video-'));
  const input = path.join(dir, 'input.bin');
  const output = path.join(dir, 'poster.webp');
  try {
    await pipeline(stream, createWriteStream(input));

    const probed = await run(
      ffprobeBin(),
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input],
      PROBE_TIMEOUT_MS,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(probed.stdout);
    } catch {
      return null;
    }
    const meta = parseVideoProbe(raw);
    if (!meta) return null;

    const at = posterPositionSeconds(meta.durationMs);
    await run(
      ffmpegBin(),
      [
        '-v',
        'error',
        '-ss',
        String(at),
        '-i',
        input,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        `thumbnail=n=40,scale=w=${VIDEO_POSTER_MAX_EDGE}:h=-2:force_original_aspect_ratio=decrease`,
        '-f',
        'webp',
        '-y',
        output,
      ],
      POSTER_TIMEOUT_MS,
    );
    const poster = await readFile(output);
    if (poster.byteLength === 0) return null;
    return { ...meta, poster };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
