import { describe, expect, it, vi } from 'vitest';

const runExtractionInWorker = vi.hoisted(() => vi.fn());

vi.mock('./file-text.runner.js', () => ({ runExtractionInWorker }));

import {
  detectAttachmentKind,
  extractAttachmentText,
  magicMatches,
} from './file-text.extractors.js';

/**
 * Вход извлечения текста (#922): вид по имени/mime, сигнатура содержимого и
 * передача разбора в worker-поток. Сам разбор — `file-text.parse.test.ts`,
 * изоляция и уничтожение потока — `file-text.runner.test.ts`.
 */

const PDF_BUFFER = Buffer.from('%PDF-1.7\n');
const extracted = {
  kind: 'pdf' as const,
  pages: [{ page: 1, text: 'Текст' }],
  totalPages: 1,
  chars: 5,
  truncated: false,
  scannedPages: [],
};

describe('detectAttachmentKind', () => {
  it('PDF и DOCX по mime и расширению; прочее — null', () => {
    expect(detectAttachmentKind('акт.pdf', 'application/octet-stream')).toBe('pdf');
    expect(detectAttachmentKind('смета.docx', 'application/octet-stream')).toBe('docx');
    expect(detectAttachmentKind('фото.jpg', 'image/jpeg')).toBeNull();
  });

  it('magic: PDF по %PDF-', () => {
    expect(magicMatches(PDF_BUFFER, 'pdf')).toBe(true);
    expect(magicMatches(Buffer.from('nope'), 'pdf')).toBe(false);
  });
});

describe('extractAttachmentText: запуск разбора', () => {
  it('несовпадение сигнатуры — FILE_TEXT_INVALID до запуска worker', async () => {
    await expect(extractAttachmentText(Buffer.from('PK\u0003\u0004'), 'pdf')).rejects.toMatchObject(
      { code: 'FILE_TEXT_INVALID' },
    );
    expect(runExtractionInWorker).not.toHaveBeenCalled();
  });

  it('передаёт разбор и обрыв запроса в worker-раннер', async () => {
    runExtractionInWorker.mockResolvedValueOnce(extracted);
    const controller = new AbortController();
    await expect(extractAttachmentText(PDF_BUFFER, 'pdf', controller.signal)).resolves.toEqual(
      extracted,
    );
    expect(runExtractionInWorker).toHaveBeenCalledWith(PDF_BUFFER, 'pdf', controller.signal);
  });
});
