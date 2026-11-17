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
  FILE_TEXT_FORBIDDEN: 403,
};

/**
 * Текст вложения для ИИ-агента (#922): права → кэш по версии → извлечение.
 *
 * Права — существующий резолвер files (`FileAccessRegistry`): владение,
 * участник беседы, видимое письмо; чужой файл — 404 (существование не
 * раскрываем). Конфиденциальное письмо — 403 `FILE_TEXT_FORBIDDEN` до кэша и
 * парсинга: граница эпика #889 «не читается ни при каком режиме». Текст ходит
 * только через API от имени сотрудника; кэш — данные портала, при смене
 * версии пересчитывается.
 *
 * Нагрузка: кэш не считается, а извлечение ограничено на сотрудника
 * (`requestsPerMinute`) и на процесс (`maxConcurrent`) — авторизованный
 * сотрудник не должен класть портал тяжёлыми документами.
 */
@Injectable()
export class FileTextService {
  /** Параллельные запросы одного файла не парсят документ дважды. */
  private readonly inflight = new Map<string, InflightExtraction>();
  /** Окна запросов извлечения по сотрудникам (без кэша). */
  private readonly hits = new Map<string, number[]>();
  /** Извлечения, реально идущие прямо сейчас (кэш не считается). */
  private running = 0;

  constructor(
    private readonly repo: FilesRepository,
    private readonly driver: MinioStorageDriver,
    private readonly office: OfficeSessionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FileTextService.name);
  }

  async extract(fileId: string, userId: string, signal?: AbortSignal): Promise<FileTextResponse> {
    // 404 для чужих файлов: тот же резолвер, что у просмотра/редактора.
    const { file, textDenied } = await this.office.resolveAccess(fileId, userId);
    // Конфиденциальное письмо: отказ ДО кэша — текст не отдаётся ИИ даже
    // участнику и держателю права просмотра (граница эпика #889).
    if (textDenied) {
      throw new DomainException(
        ErrorCode.FILE_TEXT_FORBIDDEN,
        'Text of confidential attachment is not available to AI',
        undefined,
        403,
      );
    }
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
    if (existing) return this.joinExtraction(existing, signal);
    this.assertAllowed(userId);
    const controller = new AbortController();
    const entry: InflightExtraction = { controller, waiters: 0, promise: undefined as never };
    entry.promise = this.track(() => this.extractFresh(file, controller.signal))
      .catch((error: unknown) => {
        throw mapExtractError(error);
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, entry);
    return this.joinExtraction(entry, signal);
  }

  /**
   * Ожидание общего извлечения: обрыв СВОЕГО запроса не отменяет разбор,
   * пока его ждёт кто-то ещё; последний ушедший убивает worker (job больше
   * никому не нужен, CPU и память освобождаются сразу).
   */
  private async joinExtraction(
    entry: InflightExtraction,
    signal?: AbortSignal,
  ): Promise<FileTextResponse> {
    entry.waiters += 1;
    try {
      return signal ? await abortable(entry.promise, signal) : await entry.promise;
    } catch (error) {
      throw error instanceof FileTextError ? mapExtractError(error) : error;
    } finally {
      entry.waiters -= 1;
      if (signal?.aborted && entry.waiters === 0) entry.controller.abort();
    }
  }

  /** Частота на сотрудника и параллелизм процесса: 429 RATE_LIMITED. */
  private assertAllowed(userId: string): void {
    if (this.running >= FILE_TEXT_LIMITS.maxConcurrent) {
      throw new DomainException(
        ErrorCode.RATE_LIMITED,
        'Too many concurrent text extractions',
        undefined,
        429,
      );
    }
    const now = Date.now();
    const windowStart = now - 60_000;
    const recent = (this.hits.get(userId) ?? []).filter((at) => at > windowStart);
    if (recent.length >= FILE_TEXT_LIMITS.requestsPerMinute) {
      this.hits.set(userId, recent);
      throw new DomainException(
        ErrorCode.RATE_LIMITED,
        'Too many text extractions per minute',
        undefined,
        429,
      );
    }
    recent.push(now);
    this.hits.set(userId, recent);
    // Карта не растёт бесконечно: на каждом вызове подчищаем пустые окна.
    if (this.hits.size > 5_000) {
      for (const [id, window] of this.hits) {
        if (window.every((at) => at <= windowStart)) this.hits.delete(id);
      }
    }
  }

  /** Счётчик активных извлечений: уменьшается в любом исходе. */
  private async track<T>(work: () => Promise<T>): Promise<T> {
    this.running += 1;
    try {
      return await work();
    } finally {
      this.running -= 1;
    }
  }

  private async extractFresh(file: FileObjectRow, signal: AbortSignal): Promise<FileTextResponse> {
    const kind = detectAttachmentKind(file.name, file.mime);
    if (!kind) {
      throw new FileTextError('FILE_TEXT_UNSUPPORTED');
    }
    const startedAt = Date.now();
    const buffer = await readLimited(await this.driver.get(file.key), FILE_TEXT_LIMITS.maxBytes);
    const extracted = await extractAttachmentText(buffer, kind, signal);
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

/** Общее извлечение одного файла и версии: разбор делится между запросами. */
interface InflightExtraction {
  promise: Promise<FileTextResponse>;
  controller: AbortController;
  /** Сколько запросов ещё ждут результат (последний ушедший убивает worker). */
  waiters: number;
}

/** Ожидание с обрывом: локальный отказ, разбор продолжается для остальных. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new FileTextError('FILE_TEXT_TIMEOUT'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new FileTextError('FILE_TEXT_TIMEOUT'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
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
