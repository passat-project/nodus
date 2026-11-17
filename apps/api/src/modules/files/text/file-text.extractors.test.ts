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
    pdfDocument.getPage = vi.fn(async (number: number) => {
      const lines = pdfDocument.pages[number - 1]!.split('\n');
      let index = 0;
      // Поток текста (PDF.js 6): страница отдаёт чанки, caps применяются на
      // лету. `getTextContent` намеренно не реализован — его быть не должно.
      const stream = {
        getReader: () => ({
          read: async () =>
            index < lines.length
              ? { done: false, value: { items: [{ str: lines[index++]!, hasEOL: true }] } }
              : { done: true },
          cancel: async () => undefined,
          releaseLock: () => undefined,
        }),
      };
      return { streamTextContent: () => stream };
    });
    return pdfDocument;
  }),
}));

vi.mock('mammoth', () => ({
  default: { extractRawText: vi.fn(async () => ({ value: 'Текст акта', messages: [] })) },
}));

const PDF_BUFFER = Buffer.from('%PDF-1.7\n');

interface ZipEntry {
  name: string;
  method?: 0 | 8;
  data: Buffer;
  /** Ложный размер в каталоге (бомба с подменой заголовка). */
  declaredUncompressed?: number;
}

/** Минимальный ZIP (stored или deflate) — фикстура бюджета DOCX. */
function zipBuffer(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 0;
    const uncompressed = entry.declaredUncompressed ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // CRC не проверяется бюджетом
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, entry.data);
    centrals.push(central, name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

const DOCX_BUFFER = zipBuffer([
  { name: 'word/document.xml', data: Buffer.from('<document>Текст акта</document>') },
]);

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
    const result = await extractAttachmentText(DOCX_BUFFER, 'docx');
    expect(result.kind).toBe('docx');
    expect(result.totalPages).toBeNull();
    expect(result.pages).toEqual([{ page: 1, text: 'Текст акта' }]);
  });

  it('ZIP-бомба по заявленному размеру — FILE_TEXT_TOO_LARGE', async () => {
    const bomb = zipBuffer([
      {
        name: 'word/document.xml',
        data: Buffer.from('<document>Текст</document>'),
        declaredUncompressed: FILE_TEXT_LIMITS.maxUncompressedBytes + 1,
      },
    ]);
    await expect(extractAttachmentText(bomb, 'docx')).rejects.toMatchObject({
      code: 'FILE_TEXT_TOO_LARGE',
    });
  });

  it('бомба с ложным размером в заголовке — фактическая распаковка под потолком', async () => {
    const { deflateRawSync } = await import('node:zlib');
    // 70 МБ нулей сжимаются в ~70 КБ; заголовок врёт, что распакуется 100 байт.
    const packed = deflateRawSync(Buffer.alloc(70 * 1024 * 1024));
    const bomb = zipBuffer([
      {
        name: 'word/document.xml',
        method: 8,
        data: packed,
        declaredUncompressed: 100,
      },
    ]);
    await expect(extractAttachmentText(bomb, 'docx')).rejects.toMatchObject({
      code: 'FILE_TEXT_TOO_LARGE',
    });
  });

  it('бомба в ДРУГОЙ части DOCX (styles.xml) — бюджет по всем записям', async () => {
    const { deflateRawSync } = await import('node:zlib');
    // mammoth читает не только document.xml: styles/numbering/footnotes тоже.
    // Ложный размер в заголовке styles.xml не должен проходить бюджет.
    const packed = deflateRawSync(Buffer.alloc(70 * 1024 * 1024));
    const bomb = zipBuffer([
      { name: 'word/document.xml', data: Buffer.from('<document>Текст</document>') },
      { name: 'word/styles.xml', method: 8, data: packed, declaredUncompressed: 100 },
    ]);
    await expect(extractAttachmentText(bomb, 'docx')).rejects.toMatchObject({
      code: 'FILE_TEXT_TOO_LARGE',
    });
  });

  it('скрытая запись за пределами EOCD — FILE_TEXT_INVALID, а не обход бюджета', async () => {
    const buffer = zipBuffer([
      { name: 'word/document.xml', data: Buffer.from('<document>Текст</document>') },
      { name: 'word/styles.xml', data: Buffer.from('<styles/>') },
    ]);
    // EOCD — последние 22 байта; занижаем число записей до одной.
    const eocd = buffer.length - 22;
    buffer.writeUInt16LE(1, eocd + 8);
    buffer.writeUInt16LE(1, eocd + 10);
    await expect(extractAttachmentText(buffer, 'docx')).rejects.toMatchObject({
      code: 'FILE_TEXT_INVALID',
    });
  });

  it('промежуток между каталогом и EOCD (reader.zero JSZip) — FILE_TEXT_INVALID', async () => {
    const buffer = zipBuffer([
      { name: 'word/document.xml', data: Buffer.from('<document>Текст</document>') },
      { name: 'word/styles.xml', data: Buffer.from('<styles/>') },
    ]);
    // Приманка: каталог «заканчивается» на первой записи, за ней до EOCD
    // лежит вторая — JSZip сдвинул бы чтения на этот промежуток.
    const eocd = buffer.length - 22;
    buffer.writeUInt16LE(1, eocd + 8);
    buffer.writeUInt16LE(1, eocd + 10);
    buffer.writeUInt32LE(46 + Buffer.byteLength('word/document.xml'), eocd + 12);
    await expect(extractAttachmentText(buffer, 'docx')).rejects.toMatchObject({
      code: 'FILE_TEXT_INVALID',
    });
  });
});
