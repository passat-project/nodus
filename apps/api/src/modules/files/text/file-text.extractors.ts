import { inflateRawSync } from 'node:zlib';

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
 * таймаут 25 с. Сверх этого — защита от «архивной бомбы» (security-ревью
 * 18.11.2026): ZIP-каталог DOCX и фактическая распаковка `word/document.xml`
 * ограничены, а по таймауту PDF-документ уничтожается (`destroy`), чтобы
 * разбор не продолжал жечь CPU/память после ответа 504.
 */

export const FILE_TEXT_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  /** Потолок распакованного ZIP (DOCX): 20 МБ дефляции → гигабайты в памяти. */
  maxUncompressedBytes: 64 * 1024 * 1024,
  /** Потолок фактически распакованного `word/document.xml` (бомба с ложным
   *  размером в центральном каталоге). */
  maxDocumentXmlBytes: 64 * 1024 * 1024,
  maxZipEntries: 5_000,
  /** Отношение распакованное/сжатое: бомба сжимается в сотни раз. */
  maxZipRatio: 200,
  maxPages: 100,
  maxChars: 60_000,
  /** Элементы текстового слоя одной страницы: тяжёлая страница не должна
   *  превращаться в гигантскую склейку до проверки лимита знаков. */
  maxPageItems: 20_000,
  /** Потолок знаков одной страницы до общей обрезки. */
  maxPageChars: 120_000,
  timeoutMs: 25_000,
  /** Запросов извлечения на сотрудника в минуту (кэш не считается). */
  requestsPerMinute: 10,
  /** Одновременных извлечений на процесс: разбор — CPU/память. */
  maxConcurrent: 2,
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
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

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
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const pageText = pageTextOf(content.items);
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

/** Текст страницы с потолками ДО общей склейки: элементы и знаки ограничены. */
function pageTextOf(items: readonly unknown[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const item of items.slice(0, FILE_TEXT_LIMITS.maxPageItems)) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue;
    const entry = item as { str?: unknown; hasEOL?: unknown };
    const piece = `${typeof entry.str === 'string' ? entry.str : ''}${entry.hasEOL === true ? '\n' : ''}`;
    parts.push(piece);
    length += piece.length;
    if (length >= FILE_TEXT_LIMITS.maxPageChars) break;
  }
  return parts
    .join('')
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

/**
 * Бюджет ZIP до mammoth: центральный каталог (число записей, суммарный и
 * коэффициент распаковки) + фактическая распаковка `word/document.xml` с
 * `maxOutputLength` — заголовки архива могут лгать о размере, deflate-поток
 * проверяется по факту.
 */
function assertZipBudget(buffer: Buffer): void {
  const eocd = findEocd(buffer);
  if (eocd === null) throw new FileTextError('FILE_TEXT_INVALID');
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  // ZIP64 не разбираем: DOCX его не использует, а непроверяемый архив опасен.
  if (
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entries === 0 ||
    entries > FILE_TEXT_LIMITS.maxZipEntries
  ) {
    throw new FileTextError(entries === 0 ? 'FILE_TEXT_INVALID' : 'FILE_TEXT_TOO_LARGE');
  }
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > buffer.length) throw new FileTextError('FILE_TEXT_INVALID');

  let offset = centralOffset;
  let count = 0;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let documentEntry: { localOffset: number; compressedSize: number; method: number } | null = null;
  while (offset + 46 <= centralEnd && buffer.readUInt32LE(offset) === ZIP_CENTRAL) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new FileTextError('FILE_TEXT_TOO_LARGE'); // ZIP64-запись
    }
    count += 1;
    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;
    if (count > FILE_TEXT_LIMITS.maxZipEntries) throw new FileTextError('FILE_TEXT_TOO_LARGE');
    if (totalUncompressed > FILE_TEXT_LIMITS.maxUncompressedBytes) {
      throw new FileTextError('FILE_TEXT_TOO_LARGE');
    }
    const nameStart = offset + 46;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (name === 'word/document.xml') {
      documentEntry = { localOffset, compressedSize, method };
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (count === 0) throw new FileTextError('FILE_TEXT_INVALID');
  if (totalCompressed === 0 || totalUncompressed / totalCompressed > FILE_TEXT_LIMITS.maxZipRatio) {
    throw new FileTextError('FILE_TEXT_TOO_LARGE');
  }
  if (!documentEntry) throw new FileTextError('FILE_TEXT_INVALID');
  assertDocumentXmlBudget(buffer, documentEntry);
}

/** Фактическая распаковка `word/document.xml` под потолком (защита от лжи в заголовке). */
function assertDocumentXmlBudget(
  buffer: Buffer,
  entry: { localOffset: number; compressedSize: number; method: number },
): void {
  const local = entry.localOffset;
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== ZIP_LOCAL) {
    throw new FileTextError('FILE_TEXT_INVALID');
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new FileTextError('FILE_TEXT_INVALID');
  const data = buffer.subarray(dataStart, dataEnd);
  if (entry.method === 0) {
    if (data.length > FILE_TEXT_LIMITS.maxDocumentXmlBytes) {
      throw new FileTextError('FILE_TEXT_TOO_LARGE');
    }
    return;
  }
  if (entry.method !== 8) throw new FileTextError('FILE_TEXT_UNSUPPORTED');
  try {
    inflateRawSync(data, { maxOutputLength: FILE_TEXT_LIMITS.maxDocumentXmlBytes });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ERR_BUFFER_TOO_LARGE') throw new FileTextError('FILE_TEXT_TOO_LARGE');
    throw new FileTextError('FILE_TEXT_INVALID');
  }
}

/** Смещение конца центрального каталога (EOCD) — последние 65 557 байт. */
function findEocd(buffer: Buffer): number | null {
  const min = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD) return offset;
  }
  return null;
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
