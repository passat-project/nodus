import { FileTextError } from './file-text.config.js';
import {
  magicMatches,
  type AttachmentTextKind,
  type ExtractedAttachmentText,
} from './file-text.parse.js';
import { runExtractionInWorker } from './file-text.runner.js';

export { FILE_TEXT_LIMITS, FileTextError } from './file-text.config.js';
export type { AttachmentTextKind, ExtractedAttachmentText } from './file-text.parse.js';
export { magicMatches } from './file-text.parse.js';

/**
 * Вход в извлечение текста вложений (#922): вид по имени/mime, проверка
 * сигнатуры и запуск разбора в отдельном потоке. Сам разбор —
 * `file-text.parse.ts` (PDF.js/mammoth), изоляция — `file-text.runner.ts`.
 */

/** Вид по имени/mime; фактический формат проверяется по magic-байтам. */
export function detectAttachmentKind(name: string, mime: string): AttachmentTextKind | null {
  const lower = name.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }
  return null;
}

/** Единая точка: вид уже определён, magic проверен, разбор — в worker-потоке. */
export async function extractAttachmentText(
  buffer: Buffer,
  kind: AttachmentTextKind,
  signal?: AbortSignal,
): Promise<ExtractedAttachmentText> {
  if (!magicMatches(buffer, kind)) throw new FileTextError('FILE_TEXT_INVALID');
  return runExtractionInWorker(buffer, kind, signal);
}
