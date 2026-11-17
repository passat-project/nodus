import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FILE_TEXT_LIMITS,
  detectAttachmentKind,
  extractAttachmentText,
  magicMatches,
} from './file-text.extractors.js';

/**
 * Извлечение текста вложений (#922): вид по имени/mime + magic, потолки
 * страниц/знаков, скан без текстового слоя. Парсеры PDF/DOCX подменены —
 * тест держит нашу логику пределов и честных пометок, не чужой парсер.
 */

const pdfDocument = vi.hoisted(() => ({
  pages: [] as string[],
  numPages: 0,
  cleanup: vi.fn(async () => undefined),
  getPage: vi.fn(),
}));

vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(async () => {
    pdfDocument.getPage = vi.fn(async (number: number) => ({
      getTextContent: async () => ({
        items: pdfDocument.pages[number - 1]!.split('\n').flatMap((line) => [
          { str: line, hasEOL: true },
        ]),
      }),
    }));
    return pdfDocument;
  }),
}));

vi.mock('mammoth', () => ({
  default: { extractRawText: vi.fn(async () => ({ value: 'Текст акта', messages: [] })) },
}));

const PDF_BUFFER = Buffer.from('%PDF-1.7\n');

describe('detectAttachmentKind / magicMatches', () => {
  it('PDF и DOCX по mime и расширению; прочее — null', () => {
    expect(detectAttachmentKind('акт.pdf', 'application/octet-stream')).toBe('pdf');
    expect(detectAttachmentKind('смета.docx', 'application/octet-stream')).toBe('docx');
    expect(detectAttachmentKind('фото.jpg', 'image/jpeg')).toBeNull();
  });

  it('magic: PDF по %PDF-, DOCX по ZIP-сигнатуре', () => {
    expect(magicMatches(PDF_BUFFER, 'pdf')).toBe(true);
    expect(magicMatches(Buffer.from('nope'), 'pdf')).toBe(false);
    expect(magicMatches(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), 'docx')).toBe(true);
  });
});

describe('extractAttachmentText: PDF', () => {
  beforeEach(() => {
    pdfDocument.pages = ['Страница один', 'Страница два'];
    pdfDocument.numPages = 2;
    pdfDocument.cleanup.mockClear();
  });

  it('идёт по страницам, нумерует и освобождает документ', async () => {
    const result = await extractAttachmentText(PDF_BUFFER, 'pdf');
    expect(result.kind).toBe('pdf');
    expect(result.totalPages).toBe(2);
    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages[0]!.text).toContain('Страница один');
    expect(result.truncated).toBe(false);
    expect(pdfDocument.cleanup).toHaveBeenCalled();
  });

  it('страница без текста помечается как скан, содержимое не выдумывается', async () => {
    pdfDocument.pages = ['Достаточно длинный текст страницы для акта', '   '];
    const result = await extractAttachmentText(PDF_BUFFER, 'pdf');
    expect(result.scannedPages).toEqual([2]);
  });

  it('потолок страниц и знаков ставит truncated', async () => {
    pdfDocument.pages = Array.from({ length: FILE_TEXT_LIMITS.maxPages + 5 }, () => 'Текст');
    pdfDocument.numPages = pdfDocument.pages.length;
    const result = await extractAttachmentText(PDF_BUFFER, 'pdf');
    expect(result.pages).toHaveLength(FILE_TEXT_LIMITS.maxPages);
    expect(result.truncated).toBe(true);
  });

  it('не-PDF содержимое с расширением .pdf — FILE_TEXT_INVALID', async () => {
    await expect(extractAttachmentText(Buffer.from('PK\u0003\u0004'), 'pdf')).rejects.toMatchObject(
      { code: 'FILE_TEXT_INVALID' },
    );
  });
});

describe('extractAttachmentText: DOCX', () => {
  it('отдаёт текст одной страницей без числа страниц', async () => {
    const result = await extractAttachmentText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), 'docx');
    expect(result.kind).toBe('docx');
    expect(result.totalPages).toBeNull();
    expect(result.pages).toEqual([{ page: 1, text: 'Текст акта' }]);
  });
});
