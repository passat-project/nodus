import { parentPort, workerData } from 'node:worker_threads';

import { FileTextError } from './file-text.config.js';
import { parseAttachmentText, type AttachmentTextKind } from './file-text.parse.js';

/**
 * Разбор вложения в отдельном потоке (#922, ADR-0050 п. 7): PDF.js и
 * синхронный inflate DOCX жгут CPU, и в event loop API крафтовый файл
 * останавливал бы весь портал. Родитель (`file-text.runner.ts`) убивает поток
 * по таймауту или при обрыве запроса — разбор не переживает ответ.
 */

interface WorkerInput {
  kind: AttachmentTextKind;
  bytes: Uint8Array;
}

const input = workerData as WorkerInput;

parseAttachmentText(Buffer.from(input.bytes), input.kind).then(
  (value) => parentPort?.postMessage({ ok: true, value }),
  (error: unknown) => {
    const code = error instanceof FileTextError ? error.code : 'FILE_TEXT_INVALID';
    parentPort?.postMessage({ ok: false, code });
  },
);
