import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { ErrorCode, LETTER_LIMITS } from '@nodus/contracts';
import type { FastifyRequest } from 'fastify';

import { DomainException } from '../../../core/errors/domain-exception.js';
import type { UploadedLetterFile } from './letters-manual-create.service.js';

/** Суммарный потолок запроса ручного создания: 20×100 МБ по отдельности
 *  дали бы 2 ГБ временных файлов на один запрос (security-ревью #55). */
const MAX_REQUEST_BYTES = 250 * 1024 * 1024;

/** Поля multipart-создания письма (до файлов — канон @fastify/multipart). */
export interface LetterMultipart {
  fields: Record<string, string>;
  files: UploadedLetterFile[];
  /** Удалить временный каталог (в `finally` контроллера). */
  cleanup: () => Promise<void>;
}

/**
 * Разбор multipart ручного создания письма (#55, Р8): поля идут ДО файлов,
 * файлы пишутся во временный каталог потоком (без буферизации в памяти),
 * лимит на файл — `LETTER_LIMITS.fileBytes`, количество — `LETTER_LIMITS.files`.
 * После сохранения письма контроллер удаляет каталог; при ошибке — тоже.
 */
export async function readLetterMultipart(request: FastifyRequest): Promise<LetterMultipart> {
  const dir = await mkdtemp(join(tmpdir(), 'nodus-letter-'));
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true });
  const fields: Record<string, string> = {};
  const files: UploadedLetterFile[] = [];
  let totalBytes = 0;
  try {
    const parts = request.parts({
      limits: {
        fileSize: LETTER_LIMITS.fileBytes,
        files: LETTER_LIMITS.files,
        fields: 8,
        parts: LETTER_LIMITS.files + 8,
      },
    });
    for await (const part of parts) {
      if (part.type === 'field') {
        if (!(part.fieldname in fields)) fields[part.fieldname] = String(part.value);
        continue;
      }
      const path = join(dir, `${files.length}.upload`);
      await pipeline(part.file, createWriteStream(path, { flags: 'wx' }));
      if (part.file.truncated) {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Letter file exceeds limit',
          { maxBytes: LETTER_LIMITS.fileBytes },
          413,
        );
      }
      totalBytes += part.file.bytesRead;
      if (totalBytes > MAX_REQUEST_BYTES) {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Letter files exceed request limit',
          { maxBytes: MAX_REQUEST_BYTES },
          413,
        );
      }
      files.push({
        name: part.filename || 'file',
        mime: part.mimetype || 'application/octet-stream',
        size: part.file.bytesRead,
        path,
      });
    }
  } catch (error) {
    await cleanup();
    if (error instanceof DomainException) throw error;
    throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Malformed multipart body');
  }
  return { fields, files, cleanup };
}
