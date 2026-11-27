import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ConditionRecordData } from '../../custom-fields/ports/condition-records.port.js';
import type {
  FormulaRecordData,
  RecordReadOptions,
} from '../../custom-fields/ports/record-values.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';

/**
 * Read-порт писем как источников формул (#632, Р7/Р11). Реализация живёт
 * в correspondence (владелец таблицы, I3). Письмо-источник по ссылке —
 * только через атрибут-ссылку и с проверкой видимости актёру (Р7); в
 * выборки агрегатов письма не входят (В1: конфиденциальные — никому).
 */
export const LETTER_FORMULA_VALUES: InjectionToken = 'LETTER_FORMULA_VALUES';

export interface LetterFormulaValues {
  /** Письмо-источник; actor — проверка видимости (evaluate), null — нет. */
  record(
    id: string,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData | null>;

  /** Письмо полной выборки условий (#635): без фильтра видимости (квантор
   *  честный), мягко удалённое — null. */
  conditionLetter(id: string, tx?: TransactionClient): Promise<ConditionRecordData | null>;

  /** Видимые актору письма из ids (#635, «видимость одна») — та же функция,
   *  что у реестра и карточки. */
  visibleLetterIds(
    ids: readonly string[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<ReadonlySet<string>>;
}
