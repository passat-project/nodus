import { Injectable } from '@nestjs/common';
import type { CustomFieldValues } from '@nodus/contracts';
import type { FormulaValue } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type {
  FormulaRecordData,
  RecordReadOptions,
} from '../../custom-fields/ports/record-values.port.js';
import { canViewLetter } from '../access/letter-access.js';
import type { LetterDetailRow } from '../letters/letter-row.js';
import { LettersRepository } from '../letters/letters.repository.js';
import type { LetterFormulaValues } from './letter-formula-values.port.js';

/** Системные поля письма в языке формул (#632): ключи — каталог
 *  `FORMULA_SYSTEM_FIELDS` (entity `letter`). Дата — ISO-день (грамматика
 *  типа `date` в DTO письма), время — ISO 8601 UTC (I7). */
function systemOf(row: LetterDetailRow): Record<string, FormulaValue | undefined> {
  return {
    subject: row.subject,
    regNumber: row.regNumber,
    regDate: isoDate(row.regDate),
    receivedAt: row.receivedAt.toISOString(),
    correspondent: row.counterpartyId,
    theirNumber: row.theirNumber,
    theirDate: isoDate(row.theirDate),
  };
}

const isoDate = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

/**
 * Письма как источники формул (#632, Р7/Р11): значения атрибутов и системные
 * поля письма-источника. Видимость — та же функция, что у карточки и реестра
 * (`canViewLetter`): незарегистрированное письмо доступно только канцелярии,
 * конфиденциальное — участникам и держателям права, надгробие спама (Р13) —
 * никому. Невидимое письмо = null (404 без оракула на путях актёра).
 *
 * Письмо в выборки агрегатов не входит (В1): связанные записи читаются только
 * у задач и папок, поэтому порт отдаёт одну запись. Таблицы читаются
 * репозиторием модуля (patterns.md) — прямого Prisma в порту нет.
 */
@Injectable()
export class LetterFormulaValuesProvider implements LetterFormulaValues {
  constructor(private readonly letters: LettersRepository) {}

  async record(
    id: string,
    opts: RecordReadOptions = {},
    tx?: TransactionClient,
  ): Promise<FormulaRecordData | null> {
    const row = await this.letters.findDetailById(id, tx);
    if (!row || row.deletedAt !== null) return null;
    if (opts.actor) {
      // Состав обсуждения читается только для конфиденциальных — как в
      // реестре и карточке (лишний запрос на каждое обычное письмо не нужен).
      const members = row.confidential
        ? new Set(
            (await this.letters.participants(id, tx)).map((participant) => participant.userId),
          )
        : undefined;
      if (!canViewLetter(opts.actor, row, members)) return null;
    }
    return {
      kind: 'letter',
      id: row.id,
      values: (row.customFields ?? {}) as CustomFieldValues,
      system: systemOf(row),
      projectId: row.projectId,
      // Письмо не живёт в дереве: родителя, узла и «папки» у него нет.
      parentId: null,
      nodeId: null,
      placeId: row.typeId,
      confidential: row.confidential,
    };
  }
}
