import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type {
  FormulaRecordData,
  RecordReadOptions,
} from '../../custom-fields/ports/record-values.port.js';

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
}
