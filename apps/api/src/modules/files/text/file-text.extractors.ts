import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';

/**
 * Извлечение текста вложений (#922): PDF с текстовым слоем и DOCX.
 *
 * Инструменты выбраны по состоянию 2026: `unpdf` — сборка PDF.js для Node
 * без воркера и без нативной сборки (MIT), `mammoth` — стандарт чтения DOCX
 * (BSD-2). Скан без текстового слоя НЕ распознаётся (OCR — отдельная фаза):
 * страница честно помечается как «без текста», агент не выдумывает содержимое.
 *
 * Предохранители (ADR-0050): размер ≤ 20 МБ, страниц ≤ 100, знаков ≤ 60 000,
 * таймаут 25 с. Извлечение ограниченное, поэтому идёт в HTTP-запросе (без
 * BullMQ): тяжёлый OCR и таблицы — следующая фаза.
 */

export const FILE_TEXT_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxPages: 100,
  maxChars: 60_000,
  /** Меньше этого текста на странице — считаем её сканом (без слоя). */
  scanCharsPerPage: 40,
  timeoutMs: 25_000,
} as const;

export type AttachmentTextKind = 'pdf' | 'docx';

export interface ExtractedAttachmentText {
  kind: AttachmentTextKind;
  pages: { page: number; text: string }[];
  totalPages: number | null;
  chars: number;
  truncated: boolean;
  scannedPages: number[];
}

/** Ошибка извлечения с кодом контракта (сервис превращает в DomainException). */
export class FileTextError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FileTextError';
  }
}

const PDF_MAGIC = '%PDF-';
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

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

/** Содержимое соответствует заявленному виду (защита от переименования). */
export function magicMatches(buffer: Buffer, kind: AttachmentTextKind): boolean {
  if (kind === 'pdf') return buffer.subarray(0, 5).toString('latin1') === PDF_MAGIC;
  return ZIP_MAGIC.every((byte, index) => buffer[index] === byte);
}

/** Единая точка: вид уже определён, magic проверен, размер/потолки внутри. */
export async function extractAttachmentText(
  buffer: Buffer,
  kind: AttachmentTextKind,
): Promise<ExtractedAttachmentText> {
  if (!magicMatches(buffer, kind)) throw new FileTextError('FILE_TEXT_INVALID');
  return withTimeout(kind === 'pdf' ? extractPdf(buffer) : extractDocx(buffer));
}

async function extractPdf(buffer: Buffer): Promise<ExtractedAttachmentText> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    // PDF.js забирает буфер себе: копия, чтобы исходный оставался целым.
    pdf = await getDocumentProxy(new Uint8Array(buffer));
    const totalPages = pdf.numPages;
    const limit = Math.min(totalPages, FILE_TEXT_LIMITS.maxPages);
    const pages: { page: number; text: string }[] = [];
    const scannedPages: number[] = [];
    let chars = 0;
    let truncated = totalPages > limit;
    for (let number = 1; number <= limit; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (pageText.length < FILE_TEXT_LIMITS.scanCharsPerPage) scannedPages.push(number);
      const remaining = FILE_TEXT_LIMITS.maxChars - chars;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const text = pageText.length > remaining ? pageText.slice(0, remaining) : pageText;
      if (text.length < pageText.length) truncated = true;
      chars += text.length;
      pages.push({ page: number, text });
    }
    return { kind: 'pdf', pages, totalPages, chars, truncated, scannedPages };
  } catch (error) {
    if (error instanceof FileTextError) throw error;
    throw new FileTextError('FILE_TEXT_INVALID');
  } finally {
    // PDF.js держит дерево документа в памяти — освобождаем ресурсы документа.
    await pdf?.cleanup?.(true).catch(() => undefined);
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractedAttachmentText> {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    const norm = value
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const text = norm.slice(0, FILE_TEXT_LIMITS.maxChars);
    return {
      kind: 'docx',
      // У DOCX нет страниц: одна запись, в ответе это помечается totalPages=null.
      pages: [{ page: 1, text }],
      totalPages: null,
      chars: text.length,
      truncated: text.length < norm.length,
      scannedPages: [],
    };
  } catch (error) {
    if (error instanceof FileTextError) throw error;
    throw new FileTextError('FILE_TEXT_INVALID');
  }
}

/** Таймаут: битый PDF может парситься бесконечно — ответ ограничен. */
async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new FileTextError('FILE_TEXT_TIMEOUT')),
      FILE_TEXT_LIMITS.timeoutMs,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
