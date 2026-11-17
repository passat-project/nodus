import { Worker } from 'node:worker_threads';

import { FILE_TEXT_LIMITS, FileTextError } from './file-text.config.js';
import type { AttachmentTextKind, ExtractedAttachmentText } from './file-text.parse.js';

/**
 * Разбор вложения в отдельном потоке (#922, ADR-0050 п. 7).
 *
 * PDF.js и синхронная распаковка DOCX — CPU-работа. В event loop API даже
 * «быстрый» разбор крафтового файла останавливает все маршруты портала
 * (security-ревью 18.11.2026), а `setTimeout` не прерывает синхронные фазы.
 * Поэтому разбор живёт в `worker_threads`: таймаут и обрыв запроса УБИВАЮТ
 * поток (`terminate`), а не просто отвечают 504 впустую.
 *
 * Поток создаётся на одно извлечение: извлечения редки (10/мин на сотрудника,
 * 2 одновременно на процесс), а плата за старт (~30–50 мс) меньше риска
 * держать в памяти документ прошлого запроса. Буфер передаётся копией —
 * исходный нужен вызывающему.
 */

interface WorkerReply {
  ok: boolean;
  value?: ExtractedAttachmentText;
  code?: string;
}

export async function runExtractionInWorker(
  buffer: Buffer,
  kind: AttachmentTextKind,
  signal?: AbortSignal,
): Promise<ExtractedAttachmentText> {
  if (signal?.aborted) throw new FileTextError('FILE_TEXT_TIMEOUT');
  const worker = new Worker(new URL('./file-text.worker.js', import.meta.url), {
    workerData: { kind, bytes: new Uint8Array(buffer) },
  });
  try {
    return await waitForWorker(worker, signal);
  } finally {
    // Успех: поток уже закрыт; таймаут/обрыв — terminate освобождает CPU и
    // память немедленно.
    await worker.terminate().catch(() => undefined);
  }
}

function waitForWorker(worker: Worker, signal?: AbortSignal): Promise<ExtractedAttachmentText> {
  return new Promise<ExtractedAttachmentText>((resolve, reject) => {
    let settled = false;
    const finish = (error: FileTextError | null, value?: ExtractedAttachmentText): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value as ExtractedAttachmentText);
    };
    // Таймаут и обрыв — разные причины, для клиента обе «504»: ответ всё
    // равно некому отдавать, а работа гарантированно остановлена.
    const timer = setTimeout(
      () => finish(new FileTextError('FILE_TEXT_TIMEOUT')),
      FILE_TEXT_LIMITS.timeoutMs,
    );
    const onAbort = (): void => finish(new FileTextError('FILE_TEXT_TIMEOUT'));
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (reply: WorkerReply) => {
      if (reply.ok) finish(null, reply.value);
      else finish(new FileTextError(reply.code ?? 'FILE_TEXT_INVALID'));
    });
    worker.once('error', (error: Error) => {
      finish(error instanceof FileTextError ? error : new FileTextError('FILE_TEXT_INVALID'));
    });
    // Поток умер, не прислав ответ (OOM/abort): ошибка, а не зависание.
    worker.once('exit', () => finish(new FileTextError('FILE_TEXT_INVALID')));
  });
}
