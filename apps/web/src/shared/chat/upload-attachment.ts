import type { MessageAttachment } from '@nodus/contracts';

import { apiUpload } from '../api-client.js';
import { isDomainMocked } from '../api/api-mock-config.js';

/**
 * Загрузка вложения композера (A1, #87): POST /chat/attachments →
 * MessageAttachment; сообщение отправляется с attachmentIds.
 * Лимиты — вердикт владельца 24.09: 100 МБ на файл, ≤ 20 файлов на сообщение.
 * Прогресс: XHR upload.onprogress (живой API) + таймер-пол в моках — события
 * прогресса при перехвате MSW ненадёжны, а лента загрузки должна жить.
 */

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 20;

export type UploadIssue = 'too-large' | 'too-many';

/** Валидация ДО старта загрузки (канон research: ошибка инлайном, не после
 *  потраченного трафика). Чистая функция — детерминированный unit-тест. */
export function validateFiles(
  incoming: File[],
  alreadyPending: number,
): { accepted: File[]; issue: UploadIssue | null } {
  const accepted: File[] = [];
  for (const file of incoming) {
    if (file.size > MAX_FILE_BYTES) return { accepted, issue: 'too-large' };
    if (alreadyPending + accepted.length >= MAX_FILES_PER_MESSAGE) {
      return { accepted, issue: 'too-many' };
    }
    accepted.push(file);
  }
  return { accepted, issue: null };
}

async function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null; // не изображение или битый файл — габариты не обязательны
  }
}

interface VideoMetadata {
  width: number;
  height: number;
  durationMs: number;
}

/** Метаданные видео ДО загрузки (#250): габариты/длительность из
 *  `<video loadedmetadata>` — бокс плитки и бейдж стабильны до ответа сервера;
 *  сервер перепроверит ffprobe (авторитетно). */
async function videoMetadata(file: File): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    let settled = false;
    const finish = (value: VideoMetadata | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 10_000);
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = video.duration;
      finish(
        width > 0 && height > 0
          ? {
              width,
              height,
              durationMs: Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1000)) : 0,
            }
          : null,
      );
    };
    video.onerror = () => finish(null);
    video.src = objectUrl;
  });
}

export interface UploadHandle {
  promise: Promise<MessageAttachment>;
  cancel: () => void;
}

export function uploadAttachment(file: File, onProgress: (fraction: number) => void): UploadHandle {
  const controller = new AbortController();
  // Таймер-пол прогресса: растёт к 90% пока нет реальных событий/ответа.
  let simulated = 0;
  let realEvents = false;
  const timer = window.setInterval(() => {
    if (realEvents) return;
    simulated = Math.min(0.9, simulated + 0.12);
    onProgress(simulated);
  }, 180);

  const promise = (async () => {
    // MOCK-СОГЛАШЕНИЕ (см. chat-mutation-handlers): objectURL создаётся в
    // странице и передаётся серверу как previewUrl — blob из SW не резолвится.
    // В живом контуре previewUrl игнорируется: url выдаёт хранилище (#57).
    const objectUrl = URL.createObjectURL(file);
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const imageMeta = isImage ? await imageDimensions(file) : null;
    const videoMeta = isVideo ? await videoMetadata(file) : null;
    const form = new FormData();
    // ТЕКСТОВЫЕ ПОЛЯ ДО ФАЙЛА (контракт @fastify/multipart: request.file()
    // видит только части раньше файловой — на больших файлах поля после
    // файла теряются, size=NaN → 400; репро #57).
    // previewUrl — objectURL страницы: мок-соглашение (blob из SW не резолвится).
    // У видео он играет роль src инлайн-плеера; у картинок — превью.
    if (isImage || isVideo) form.append('previewUrl', objectUrl);
    // size — заявленный размер (File.size): живой контур стримит в хранилище,
    // а putObject из стрима требует размер заранее; сервер сверит с байтами.
    form.append('size', String(file.size));
    if (imageMeta) {
      form.append('width', String(imageMeta.width));
      form.append('height', String(imageMeta.height));
    }
    if (videoMeta) {
      form.append('width', String(videoMeta.width));
      form.append('height', String(videoMeta.height));
      form.append('durationMs', String(videoMeta.durationMs));
    }
    form.append('file', file);
    try {
      const attachment = await apiUpload<MessageAttachment>('/chat/attachments', form, {
        signal: controller.signal,
        // Полумок-режим (chat живой при активном MSW): грузим мимо перехватчика —
        // большие multipart-тела XHR-passthrough MSW искажает (#57).
        mswBypassIfLive: 'chat',
        onProgress: (fraction) => {
          realEvents = true;
          onProgress(Math.max(fraction, simulated));
        },
      });
      onProgress(1);
      return attachment;
    } finally {
      window.clearInterval(timer);
      // objectURL нужен только мок-хендлеру (url вложения в демо); в живом
      // режиме url выдаёт сервер — ссылку на File освобождаем (валидация #57).
      if (!isDomainMocked('chat')) URL.revokeObjectURL(objectUrl);
    }
  })();

  return { promise, cancel: () => controller.abort() };
}
