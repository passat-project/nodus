import { describe, expect, it } from 'vitest';

import { transitionFormInputSchema } from '../workflows/transition-form.schemas.js';
import { checkLetterDates, letterRegistrationInputSchema } from './letter-registration.schemas.js';

const id = () => crypto.randomUUID();

const input = {
  counterpartyId: id(),
  signerId: null,
  theirNumber: ' 0359-КЖ/147 ',
  theirDate: '2026-10-20',
  subject: 'Замечания по разделу КЖ',
  receiptMethodId: id(),
  projectId: null,
  addresseeId: id(),
  responseDeadline: null,
};

describe('ввод регистрации письма (#55, Р1)', () => {
  it('обязательные поля и обрезка пробелов; адресат обязателен (В1)', () => {
    const parsed = letterRegistrationInputSchema.parse(input);
    expect(parsed.theirNumber).toBe('0359-КЖ/147');
    expect(letterRegistrationInputSchema.safeParse({ ...input, addresseeId: null }).success).toBe(
      false,
    );
    expect(letterRegistrationInputSchema.safeParse({ ...input, subject: '   ' }).success).toBe(
      false,
    );
  });

  it('лишний ключ отвергается (strict); лимиты номера и темы', () => {
    expect(letterRegistrationInputSchema.safeParse({ ...input, regNumber: 'Вх-1' }).success).toBe(
      false,
    );
    expect(
      letterRegistrationInputSchema.safeParse({ ...input, theirNumber: '1'.repeat(65) }).success,
    ).toBe(false);
    expect(
      letterRegistrationInputSchema.safeParse({ ...input, subject: 'я'.repeat(501) }).success,
    ).toBe(false);
  });

  it('подтверждение подсказки «ответ на» — необязательный uuid или null (#56, Р5)', () => {
    const replyToLetterId = id();
    expect(letterRegistrationInputSchema.parse({ ...input, replyToLetterId })).toMatchObject({
      replyToLetterId,
    });
    expect(letterRegistrationInputSchema.parse({ ...input, replyToLetterId: null })).toMatchObject({
      replyToLetterId: null,
    });
    expect(letterRegistrationInputSchema.parse(input).replyToLetterId).toBeUndefined();
    expect(
      letterRegistrationInputSchema.safeParse({ ...input, replyToLetterId: 'не-uuid' }).success,
    ).toBe(false);
  });

  it('раздел регистрации — часть тела перехода движка', () => {
    const body = transitionFormInputSchema.parse({ registration: input });
    expect(body.registration?.addresseeId).toBe(input.addresseeId);
    expect(transitionFormInputSchema.safeParse({ registration: { subject: 'x' } }).success).toBe(
      false,
    );
  });

  it('конфиденциальность и приложенные письма — новые поля регистрации (#461)', () => {
    const attachedOrg = id();
    const parsed = letterRegistrationInputSchema.parse({
      ...input,
      confidential: true,
      attachedRefs: [
        { number: ' 456 ', counterpartyId: attachedOrg, date: '2026-10-01' },
        { number: '78', counterpartyId: id(), date: null },
      ],
    });
    expect(parsed.confidential).toBe(true);
    expect(parsed.attachedRefs?.[0]).toEqual({
      number: '456',
      counterpartyId: attachedOrg,
      date: '2026-10-01',
    });
    // Организация — только контрагент справочника (вердикт 05.11.2026):
    // строки без контрагента и свободный текст отклоняются схемой.
    expect(
      letterRegistrationInputSchema.safeParse({
        ...input,
        attachedRefs: [{ number: '456', counterpartyId: null, date: null }],
      }).success,
    ).toBe(false);
    expect(
      letterRegistrationInputSchema.safeParse({
        ...input,
        attachedRefs: [{ number: '456', counterpartyId: id(), orgText: 'Текст', date: null }],
      }).success,
    ).toBe(false);
    // Лимит строк и номера — контракт (20 / 64).
    expect(
      letterRegistrationInputSchema.safeParse({
        ...input,
        attachedRefs: Array.from({ length: 21 }, (_, index) => ({
          number: String(index + 1),
          counterpartyId: id(),
          date: null,
        })),
      }).success,
    ).toBe(false);
    expect(
      letterRegistrationInputSchema.safeParse({
        ...input,
        attachedRefs: [{ number: '1'.repeat(65), counterpartyId: id(), date: null }],
      }).success,
    ).toBe(false);
    // Старое тело без новых полей остаётся валидным (аддитивность).
    expect(letterRegistrationInputSchema.parse(input).confidential).toBeUndefined();
  });
});

describe('checkLetterDates (одна грамматика веба, моков и сервера)', () => {
  const today = '2026-10-26';

  it('дата корреспондента — не позже сегодня; срок ответа — не раньше', () => {
    expect(checkLetterDates({ theirDate: today, responseDeadline: today }, today)).toEqual([]);
    expect(checkLetterDates({ theirDate: '2026-10-27' }, today)).toEqual([
      { field: 'theirDate', reason: 'in_future' },
    ]);
    expect(checkLetterDates({ responseDeadline: '2026-10-25' }, today)).toEqual([
      { field: 'responseDeadline', reason: 'in_past' },
    ]);
  });

  it('пустые даты не проверяются — обязательность решает схема', () => {
    expect(checkLetterDates({ theirDate: null, responseDeadline: null }, today)).toEqual([]);
    expect(checkLetterDates({}, today)).toEqual([]);
  });

  it('граница года сравнивается корректно (ISO-строки)', () => {
    expect(checkLetterDates({ theirDate: '2026-12-31' }, '2027-01-01')).toEqual([]);
    expect(checkLetterDates({ responseDeadline: '2026-12-31' }, '2027-01-01')).toEqual([
      { field: 'responseDeadline', reason: 'in_past' },
    ]);
  });
});
