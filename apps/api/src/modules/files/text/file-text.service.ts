import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ErrorCode, type FileTextPage, type FileTextResponse } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  FilesRepository,
  type FileObjectRow,
  type FileTextExtractRow,
} from '../files.repository.js';
import { OfficeSessionService } from '../office/office-session.service.js';
import { MinioStorageDriver } from '../storage/minio-storage.driver.js';
import {
  FILE_TEXT_LIMITS,
  FileTextError,
  detectAttachmentKind,
  extractAttachmentText,
} from './file-text.extractors.js';

/** HTTP-статус ошибки извлечения по коду контракта. */
const STATUS_BY_CODE: Record<string, number> = {
  FILE_TEXT_TOO_LARGE: 413,
  FILE_TEXT_UNSUPPORTED: 415,
  FILE_TEXT_INVALID: 422,
  FILE_TEXT_TIMEOUT: 504,
};

/**
 * Текст вложения для ИИ-агента (#922): права → кэш по версии → извлечение.
 *
 * Права — существующий резолвер files (`FileAccessRegistry`): владение,
 * участник беседы, видимое письмо; чужой файл — 404 (существование не
 * раскрываем). Текст ходит только через API от имени сотрудника; кэш —
 * данные портала, при смене версии пересчитывается.
 */
@Injectable()
export class FileTextService {
  /** Параллельные запросы одного файла не парсят документ дважды. */
  private readonly inflight = new Map<string, Promise<FileTextResponse>>();

  constructor(
    private readonly repo: FilesRepository,
    private readonly driver: MinioStorageDriver,
    private readonly office: OfficeSessionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FileTextService.name);
  }

  async extract(fileId: string, userId: string): Promise<FileTextResponse> {
    // 404 для чужих файлов: тот же резолвер, что у просмотра/редактора.
    const { file } = await this.office.resolveAccess(fileId, userId);
    if (file.scanStatus === 'infected') {
      throw new DomainException(ErrorCode.FILE_QUARANTINED, 'File is quarantined', undefined, 410);
    }
    const cached = await this.repo.findTextExtract(file.id);
    if (cached && cached.version === file.version) return toResponse(file, cached);
    if (file.size > FILE_TEXT_LIMITS.maxBytes) {
      throw new DomainException(
        ErrorCode.FILE_TEXT_TOO_LARGE,
        'File is too large for text extraction',
        undefined,
        413,
      );
    }
    const key = `${file.id}:${file.version}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const task = this.extractFresh(file)
      .catch((error: unknown) => {
        throw mapExtractError(error);
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async extractFresh(file: FileObjectRow): Promise<FileTextResponse> {
    const kind = detectAttachmentKind(file.name, file.mime);
    if (!kind) {
      throw new FileTextError('FILE_TEXT_UNSUPPORTED');
    }
    const startedAt = Date.now();
    const buffer = await readLimited(await this.driver.get(file.key), FILE_TEXT_LIMITS.maxBytes);
    const extracted = await extractAttachmentText(buffer, kind);
    await this.repo.saveTextExtract({
      fileId: file.id,
      version: file.version,
      kind: extracted.kind,
      pages: extracted.pages,
      totalPages: extracted.totalPages,
      chars: extracted.chars,
      truncated: extracted.truncated,
      scannedPages: extracted.scannedPages,
    });
    // Аудит чтения: журнал вызова инструмента пишет ассистент, здесь — файл,
    // объём и время; текст в лог не попадает.
    this.logger.info(
      {
        fileId: file.id,
        version: file.version,
        kind: extracted.kind,
        pages: extracted.pages.length,
        chars: extracted.chars,
        truncated: extracted.truncated,
        scannedPages: extracted.scannedPages.length,
        durationMs: Date.now() - startedAt,
      },
      'File text extracted',
    );
    return {
      fileId: file.id,
      name: file.name,
      kind: extracted.kind,
      totalPages: extracted.totalPages,
      pagesRead: extracted.pages.length,
      pages: extracted.pages,
      chars: extracted.chars,
      truncated: extracted.truncated,
      scannedPages: extracted.scannedPages,
    };
  }
}

/** Строка кэша → ответ контракта (JSONB терпим к старым записям). */
function toResponse(file: FileObjectRow, row: FileTextExtractRow): FileTextResponse {
  const pages = Array.isArray(row.pages) ? row.pages.flatMap((entry) => parsePage(entry)) : [];
  const scannedPages = Array.isArray(row.scannedPages)
    ? row.scannedPages.filter((page): page is number => typeof page === 'number')
    : [];
  return {
    fileId: file.id,
    name: file.name,
    kind: row.kind === 'docx' ? 'docx' : 'pdf',
    totalPages: row.totalPages,
    pagesRead: pages.length,
    pages,
    chars: row.chars,
    truncated: row.truncated,
    scannedPages,
  };
}

function parsePage(entry: unknown): FileTextPage[] {
  if (!entry || typeof entry !== 'object') return [];
  const record = entry as { page?: unknown; text?: unknown };
  if (typeof record.page !== 'number' || typeof record.text !== 'string') return [];
  return [{ page: record.page, text: record.text }];
}

/** Поток → буфер с жёстким потолком: лишний байт — ошибка, а не память. */
async function readLimited(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > maxBytes) throw new FileTextError('FILE_TEXT_TOO_LARGE');
      chunks.push(buffer);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks);
}

/** Ошибка извлечения → доменная ошибка с кодом и HTTP-статусом. */
function mapExtractError(error: unknown): Error {
  if (error instanceof FileTextError) {
    return new DomainException(
      error.code as ErrorCode,
      `File text extraction failed: ${error.code}`,
      undefined,
      STATUS_BY_CODE[error.code] ?? 422,
    );
  }
  return error instanceof Error ? error : new Error('File text extraction failed');
}
