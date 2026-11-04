import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { Inject, Injectable } from '@nestjs/common';
import {
  CORRESPONDENCE_EVENTS,
  ErrorCode,
  LETTER_LIMITS,
  type AuthUser,
  type CreateLetterFields,
  type LetterDetail,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/ports/file-storage.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { LettersQueryService } from './letters-query.service.js';
import { LettersRepository } from './letters.repository.js';

/** Файл ручного создания: контроллер уже сохранил часть во временный файл. */
export interface UploadedLetterFile {
  name: string;
  mime: string;
  size: number;
  path: string;
}

/**
 * Ручное создание входящего (#55): скан бумаги сразу в «Новые» — файлы
 * потоком в хранилище, письмо и вложения одной транзакцией; при отказе
 * объекты хранилища убираются (компенсация). Только тип направления
 * `incoming`; тип и начальная стадия — каталог «Процессов».
 */
@Injectable()
export class LettersManualCreateService {
  constructor(
    private readonly repo: LettersRepository,
    private readonly query: LettersQueryService,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
  ) {}

  async create(
    user: AuthUser,
    fields: CreateLetterFields,
    parts: readonly UploadedLetterFile[],
  ): Promise<LetterDetail> {
    if (parts.length === 0) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'At least one file is required');
    }
    if (parts.length > LETTER_LIMITS.files) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Too many files', {
        max: LETTER_LIMITS.files,
      });
    }
    if (fields.mainIndex >= parts.length) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Main document index is out of range',
        {
          mainIndex: fields.mainIndex,
          files: parts.length,
        },
      );
    }
    const type = await this.catalog.resolveType(fields.typeId, {
      category: 'letter',
      requireCreatable: true,
      actorId: user.id,
    });
    if (type.direction !== 'incoming') {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Manual creation is only for incoming letters',
      );
    }
    const stages = await this.catalog.liveStages(type.workflowId);
    const initial = stages.find((stage) => stage.isInitial);
    if (!initial) throw new DomainException(ErrorCode.CONFLICT, 'Workflow has no initial stage');

    const saved: string[] = [];
    try {
      const attachments: { fileId: string; role: string; sortOrder: number }[] = [];
      for (const [index, part] of parts.entries()) {
        const { fileId } = await this.storage.save(
          { ownerId: user.id, name: part.name, mime: part.mime, size: part.size },
          createReadStream(part.path),
        );
        saved.push(fileId);
        attachments.push({
          fileId,
          role: index === fields.mainIndex ? 'main' : 'attachment',
          sortOrder: index,
        });
      }
      const letterId = randomUUID();
      await this.txRunner.run(async (tx) => {
        await this.repo.create(tx, {
          id: letterId,
          typeId: type.id,
          workflowId: type.workflowId,
          stageId: initial.id,
          systemState: initial.systemState,
          direction: 'incoming',
          source: 'manual',
          createdBy: user.id,
          receivedAt: new Date(),
          attachments: { create: attachments },
        });
        await this.eventBus.emit(
          tx,
          CORRESPONDENCE_EVENTS.LETTER_RECEIVED,
          {
            letterId,
            typeId: type.id,
            direction: 'incoming',
            source: 'manual',
            subject: null,
            fileIds: attachments.map((attachment) => attachment.fileId),
          },
          { actorId: user.id, aggregateType: 'letter', aggregateId: letterId },
        );
      });
      return await this.query.detail(user, letterId);
    } catch (error) {
      // Письмо не создалось — объекты хранилища не должны остаться сиротами.
      await this.storage.remove(saved).catch(() => undefined);
      throw error;
    }
  }
}
