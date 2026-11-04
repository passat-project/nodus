import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type LetterAttachedRefInput,
  type LetterRegistrationIssue,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../../crm/ports/counterparty-reader.port.js';
import type { LetterAttachedRefInput as AttachedRefWrite } from './letter-attached-refs.repository.js';
import { asDate } from './letter-fields.validator.js';

const fail = (issue: LetterRegistrationIssue): never => {
  throw new DomainException(
    ErrorCode.LETTER_REGISTRATION_INVALID,
    'Letter registration is invalid',
    { field: issue.field, reason: issue.reason },
  );
};

/** Наборы «приложенных писем» совпадают (номер + организация + дата). */
export function sameAttachedRefs(
  before: readonly AttachedRefWrite[],
  after: readonly AttachedRefWrite[],
): boolean {
  const key = (ref: AttachedRefWrite) =>
    [
      ref.number,
      ref.counterpartyId ?? '',
      ref.orgText ?? '',
      ref.letterDate ? ref.letterDate.toISOString().slice(0, 10) : '',
    ].join('|');
  return (
    before.length === after.length && before.every((ref, index) => key(ref) === key(after[index]!))
  );
}

/**
 * Строки «приложенных писем» (#461, Р3): одна проверка для окна регистрации
 * и правки карточки. Организация обязательна (контрагент справочника ИЛИ
 * текст с листа), контрагент — живой, точный дубль строки (номер +
 * организация + дата) — 422 `duplicate`. Лимиты строк/номеров — контракт
 * (`LETTER_LIMITS`), их держит zod.
 */
@Injectable()
export class LetterAttachedRefsValidator {
  constructor(@Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader) {}

  async validate(inputs: readonly LetterAttachedRefInput[]): Promise<AttachedRefWrite[]> {
    const seen = new Set<string>();
    const rows: AttachedRefWrite[] = [];
    for (const input of inputs) {
      if (!input.counterpartyId && !input.orgText) {
        fail({ field: 'attachedRefs', reason: 'required' });
      }
      if (input.counterpartyId) {
        const ref = await this.counterparties.activeRef(input.counterpartyId);
        if (!ref) fail({ field: 'attachedRefs', reason: 'not_found' });
      }
      const key = [
        input.number.toLowerCase(),
        input.counterpartyId ?? '',
        (input.orgText ?? '').toLowerCase(),
        input.date ?? '',
      ].join('|');
      if (seen.has(key)) fail({ field: 'attachedRefs', reason: 'duplicate' });
      seen.add(key);
      rows.push({
        number: input.number,
        counterpartyId: input.counterpartyId,
        orgText: input.orgText,
        letterDate: asDate(input.date),
      });
    }
    return rows;
  }
}
