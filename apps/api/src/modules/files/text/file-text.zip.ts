import { inflateRawSync } from 'node:zlib';

import { FILE_TEXT_LIMITS, FileTextError } from './file-text.config.js';

/**
 * ZIP-бюджет DOCX до mammoth (#922, ADR-0050; security-ревью 18.11.2026).
 *
 * Заголовки ZIP могут лгать о размере, а mammoth читает не только
 * `word/document.xml`: styles/numbering/footnotes/comments, а главный документ
 * резолвится через `_rels/.rels`. Поэтому проверяется КАЖДАЯ запись
 * центрального каталога — фактической распаковкой с `maxOutputLength` и общим
 * потолком; скрытые записи за границей EOCD и ZIP64 отвергаются.
 */

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

export function assertZipBudget(buffer: Buffer): void {
  const eocd = findEocd(buffer);
  if (eocd === null) throw new FileTextError('FILE_TEXT_INVALID');
  const declaredEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  // ZIP64 не разбираем: DOCX его не использует, а непроверяемый архив опасен.
  if (
    declaredEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    declaredEntries === 0 ||
    declaredEntries > FILE_TEXT_LIMITS.maxZipEntries
  ) {
    throw new FileTextError(declaredEntries === 0 ? 'FILE_TEXT_INVALID' : 'FILE_TEXT_TOO_LARGE');
  }
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > buffer.length) throw new FileTextError('FILE_TEXT_INVALID');

  let offset = centralOffset;
  let count = 0;
  let declaredTotal = 0;
  let compressedTotal = 0;
  let actualTotal = 0;
  while (offset + 46 <= centralEnd && buffer.readUInt32LE(offset) === ZIP_CENTRAL) {
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    // Шифрованный архив mammoth/JSZip всё равно не прочитает.
    if ((flags & 0x1) !== 0) throw new FileTextError('FILE_TEXT_INVALID');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new FileTextError('FILE_TEXT_TOO_LARGE'); // ZIP64-запись
    }
    count += 1;
    // Скрытые записи за пределами заявленного числа EOCD не прячутся от бюджета.
    if (count > declaredEntries) throw new FileTextError('FILE_TEXT_INVALID');
    if (count > FILE_TEXT_LIMITS.maxZipEntries) throw new FileTextError('FILE_TEXT_TOO_LARGE');
    declaredTotal += uncompressedSize;
    compressedTotal += compressedSize;
    if (declaredTotal > FILE_TEXT_LIMITS.maxUncompressedBytes) {
      throw new FileTextError('FILE_TEXT_TOO_LARGE');
    }
    actualTotal += inflateEntry(
      buffer,
      { localOffset, compressedSize, method },
      FILE_TEXT_LIMITS.maxUncompressedBytes - actualTotal,
    );
    offset = offset + 46 + nameLength + extraLength + commentLength;
  }
  // Каталог разобран ровно на заявленную длину: иначе часть записей увидит
  // только JSZip, а не бюджет.
  if (count === 0 || count !== declaredEntries || offset !== centralEnd) {
    throw new FileTextError('FILE_TEXT_INVALID');
  }
  if (compressedTotal === 0 || declaredTotal / compressedTotal > FILE_TEXT_LIMITS.maxZipRatio) {
    throw new FileTextError('FILE_TEXT_TOO_LARGE');
  }
}

/**
 * Фактическая распаковка одной записи под общим остатком бюджета: заголовок
 * может занижать размер, deflate-поток проверяется по факту.
 */
function inflateEntry(
  buffer: Buffer,
  entry: { localOffset: number; compressedSize: number; method: number },
  remaining: number,
): number {
  if (remaining <= 0) throw new FileTextError('FILE_TEXT_TOO_LARGE');
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
    if (data.length > remaining) throw new FileTextError('FILE_TEXT_TOO_LARGE');
    return data.length;
  }
  if (entry.method !== 8) throw new FileTextError('FILE_TEXT_UNSUPPORTED');
  try {
    return inflateRawSync(data, { maxOutputLength: remaining }).length;
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
