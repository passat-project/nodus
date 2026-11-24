import type { ChatMessage } from '@nodus/contracts';

import type { ThumbnailQueue } from './thumbnail.queue.js';

/**
 * Ленивый прогрев превью (#221, #250): изображения/видео без миниатюры
 * (сбой очереди прошлых прогонов, строка старее конвейера) замечены показом
 * ленты — ставим фоновую задачу; готовность привезёт
 * chat.attachment_preview_ready, а до неё плитка держит заглушку и НЕ грузит
 * оригинал.
 *
 * Память прогретых (за жизнь процесса, ревью #221): вечные miss'ы — битые
 * файлы, чей декод тихо отказывает, — не должны ставить джобу на КАЖДЫЙ
 * показ ленты (чтение S3 до 100 МБ + падение декода). Один miss — одна
 * джоба за процесс; рестарт даёт редкий дешёвый повтор. Джобы идемпотентны
 * (готовое превью — no-op воркера).
 */
const warmed = new Set<string>();

export function warmMissingPreviews(items: ChatMessage[], queue: ThumbnailQueue): void {
  for (const message of items) {
    for (const attachment of message.attachments) {
      if (attachment.kind !== 'image' && attachment.kind !== 'video') continue;
      if (attachment.thumbnailUrl !== null) continue;
      if (warmed.has(attachment.id)) continue;
      warmed.add(attachment.id);
      if (warmed.size > 5000) warmed.clear(); // кап памяти: редкий повтор дешевле утечки
      void queue.enqueue(attachment.id, attachment.fileId).catch(() => undefined);
    }
  }
}
