import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';

import { FILE_TEXT_LIMITS, FileTextError } from './file-text.config.js';
import { assertZipBudget } from './file-text.zip.js';

export { FILE_TEXT_LIMITS, FileTextError } from './file-text.config.js';

/**
 * Извлечение текста вложений (#922): PDF с текстовым слоем и DOCX.
 *
 * Инструменты выбраны по состоянию 2026: `unpdf` — сборка PDF.js для Node
 * без воркера и без нативной сборки (MIT), `mammoth` — стандарт чтения DOCX
 * (BSD-2). Скан без текстового слоя НЕ распознаётся (OCR — отдельная фаза):
 * страница честно помечается как «без текста», агент не выдумывает содержимое.
 *
 * Предохранители (ADR-0050): размер ≤ 20 МБ, страниц ≤ 100, знаков ≤ 60 000,
 * таймаут 25 с. Сверх этого — защита от «архивной бомбы» (security-ревью
 * 18.11.2026, `file-text.zip.ts`): ZIP-каталог DOCX и ФАКТИЧЕСКАЯ распаковка
 * каждой записи ограничены, текст PDF читается ПОТОКОМ с обрывом на потолке, а
 * по таймауту PDF-документ уничтожается (`destroy`), чтобы разбор не
 * продолжал жечь CPU/память после ответа 504.
 */

export type AttachmentTextKind = 'pdf' | 'docx';

export interface ExtractedAttachmentText {
  kind: AttachmentTextKind;
  pages: { page: number; text: string }[];
  totalPages: number | null;
  chars: number;
  truncated: boolean;
  scannedPages: number[];
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
  // PDF.js: отмена = destroy() у loadingTask (он владеет worker'ом).
  let pdf: { loadingTask: { destroy: () => Promise<void> } } | null = null;
  const work =
    kind === 'pdf'
      ? extractPdf(buffer, (instance) => {
          pdf = instance;
        })
      : extractDocx(buffer);
  // Таймаут не просто бросает 504: PDF-документ уничтожается, иначе разбор
  // продолжал бы потреблять CPU после ответа (security-ревью 18.11.2026).
  return withTimeout(work, () => {
    void pdf?.loadingTask.destroy().catch(() => undefined);
  });
}

async function extractPdf(
  buffer: Buffer,
  onDocument: (document: { loadingTask: { destroy: () => Promise<void> } }) => void,
): Promise<ExtractedAttachmentText> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    // PDF.js забирает буфер себе: копия, чтобы исходный оставался целым.
    pdf = await getDocumentProxy(new Uint8Array(buffer));
    onDocument(pdf);
    const totalPages = pdf.numPages;
    const limit = Math.min(totalPages, FILE_TEXT_LIMITS.maxPages);
    const pages: { page: number; text: string }[] = [];
    const scannedPages: number[] = [];
    let chars = 0;
    let truncated = totalPages > limit;
    for (let number = 1; number <= limit; number += 1) {
      const page = (await pdf.getPage(number)) as unknown as PdfTextPage;
      const pageText = await pageTextOfPage(page);
      // «Скан» — страница БЕЗ слоя вообще; страница с парой знаков (штамп,
      // колонтитул) остаётся текстом и не противоречит пометке «не читается».
      if (pageText.length === 0) scannedPages.push(number);
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

/** Структурный вид страницы PDF.js: поток текста предпочтителен (см. ниже). */
interface PdfTextPage {
  streamTextContent?: (options?: { includeMarkedContent?: boolean }) => unknown;
  getTextContent?: () => Promise<{ items?: readonly unknown[] }>;
}

interface TextChunkReader {
  read(): Promise<{ done: boolean; value?: { items?: readonly unknown[] } }>;
  cancel(): Promise<void>;
  releaseLock?(): void;
}

interface TextChunkStream {
  getReader(): TextChunkReader;
}

/**
 * Текст страницы ПОТОКОМ (`streamTextContent`), а не `getTextContent`:
 * последний сначала материализует все элементы страницы в память, и крафтовый
 * PDF даёт всплеск до потолков (security-ревью 18.11.2026). Поток обрывается
 * на первом же превышении элементов/знаков.
 */
async function pageTextOfPage(page: PdfTextPage): Promise<string> {
  if (typeof page.streamTextContent !== 'function') {
    const content = await page.getTextContent?.();
    return normalizePage(pageTextOf(content?.items ?? []));
  }
  const stream = page.streamTextContent({ includeMarkedContent: false }) as TextChunkStream;
  const reader = stream.getReader();
  const parts: string[] = [];
  let length = 0;
  let items = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value?.items ?? []) {
        const piece = itemText(item);
        if (!piece) continue;
        parts.push(piece);
        length += piece.length;
        items += 1;
        if (items >= FILE_TEXT_LIMITS.maxPageItems || length >= FILE_TEXT_LIMITS.maxPageChars) {
          await reader.cancel().catch(() => undefined);
          return normalizePage(parts.join(''));
        }
      }
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // поток уже закрыт/отменён
    }
  }
  return normalizePage(parts.join(''));
}

/** Текст страницы с потолками ДО общей склейки: элементы и знаки ограничены. */
function pageTextOf(items: readonly unknown[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const item of items.slice(0, FILE_TEXT_LIMITS.maxPageItems)) {
    const piece = itemText(item);
    if (!piece) continue;
    parts.push(piece);
    length += piece.length;
    if (length >= FILE_TEXT_LIMITS.maxPageChars) break;
  }
  return normalizePage(parts.join(''));
}

/** Один элемент текстового слоя PDF.js: строка + перевод строки на EOL. */
function itemText(item: unknown): string {
  if (!item || typeof item !== 'object' || !('str' in item)) return '';
  const entry = item as { str?: unknown; hasEOL?: unknown };
  return `${typeof entry.str === 'string' ? entry.str : ''}${entry.hasEOL === true ? '\n' : ''}`;
}

function normalizePage(text: string): string {
  return text
    .slice(0, FILE_TEXT_LIMITS.maxPageChars)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(buffer: Buffer): Promise<ExtractedAttachmentText> {
  try {
    assertZipBudget(buffer);
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

/** Таймаут: битый PDF/тяжёлый DOCX могут разбираться бесконечно. */
async function withTimeout<T>(work: Promise<T>, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new FileTextError('FILE_TEXT_TIMEOUT'));
    }, FILE_TEXT_LIMITS.timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
