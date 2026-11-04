import { describe, expect, it } from 'vitest';
import type { DictionaryItem, LetterDetail } from '@nodus/contracts';

import { formatIsoDate, parseRuDate } from './letter-format.js';
import {
  defaultReceiptMethodId,
  draftIssues,
  initialDraft,
  letterRegistrationInput,
  missingFields,
  nextEmptyField,
  registrationInputOf,
  type RegistrationDraft,
} from './registration-draft.js';

const method = (id: string, code: string): DictionaryItem => ({
  id,
  dictionaryId: 'd',
  parentId: null,
  code,
  name: code,
  sortOrder: 0,
  isActive: true,
});
const METHODS = [
  method('00000000-0000-4000-8000-0000000000e1', 'email'),
  method('00000000-0000-4000-8000-0000000000e2', 'post'),
];

const letter = {
  source: 'mail',
  counterparty: null,
  signer: null,
  theirNumber: null,
  theirDate: null,
  subject: 'О корректировке сроков',
  receiptMethod: null,
  project: null,
  addressee: null,
  responseDeadline: null,
  customFields: {},
  attachments: [],
  body: { kind: 'none' },
  attachedRefs: [],
  confidential: false,
} as unknown as LetterDetail;

const complete = (patch: Partial<RegistrationDraft> = {}): RegistrationDraft => ({
  ...initialDraft(letter, METHODS),
  counterparty: { id: '00000000-0000-4000-8000-000000000001', name: 'АО «Галургия»' },
  theirNumber: ' 0359-КЖ/152 ',
  theirDate: '2026-10-25',
  addressee: {
    id: '00000000-0000-4000-8000-000000000007',
    displayName: 'Валерия Шайдерова',
    avatarUrl: null,
  },
  ...patch,
});

describe('черновик регистрации (#55, U5)', () => {
  it('почта — тема и «Электронная почта» предзаполнены; бумага — «Почта»', () => {
    const draft = initialDraft(letter, METHODS);
    expect(draft.subject).toBe('О корректировке сроков');
    expect(draft.receiptMethodId).toBe(METHODS[0]!.id);
    expect(defaultReceiptMethodId('manual', METHODS)).toBe(METHODS[1]!.id);
  });

  it('«Не хватает»: корреспондент, их № и дата, адресат — в порядке формы', () => {
    expect(missingFields(initialDraft(letter, METHODS))).toEqual([
      'counterpartyId',
      'theirNumber',
      'theirDate',
      'addresseeId',
    ]);
  });

  it('Enter ведёт к следующему ПУСТОМУ обязательному полю (тема почты пропускается)', () => {
    const draft = { ...initialDraft(letter, METHODS), counterparty: complete().counterparty };
    expect(nextEmptyField(draft, 'counterpartyId')).toBe('theirNumber');
    expect(
      nextEmptyField({ ...draft, theirNumber: '1', theirDate: '2026-10-25' }, 'theirDate'),
    ).toBe('addresseeId');
    expect(nextEmptyField(complete(), 'addresseeId')).toBeNull();
  });

  it('тело — только id, строки обрезаны; неготовая форма и даты против сегодня — null', () => {
    expect(registrationInputOf(complete(), '2026-10-26')).toEqual({
      counterpartyId: '00000000-0000-4000-8000-000000000001',
      signerId: null,
      theirNumber: '0359-КЖ/152',
      theirDate: '2026-10-25',
      subject: 'О корректировке сроков',
      receiptMethodId: METHODS[0]!.id,
      projectId: null,
      addresseeId: '00000000-0000-4000-8000-000000000007',
      responseDeadline: null,
      confidential: false,
    });
    expect(registrationInputOf(initialDraft(letter, METHODS), '2026-10-26')).toBeNull();
    const future = complete({ theirDate: '2026-10-27' });
    expect(draftIssues(future, '2026-10-26')).toEqual([
      { field: 'theirDate', reason: 'in_future' },
    ]);
    expect(registrationInputOf(future, '2026-10-26')).toBeNull();
    expect(
      registrationInputOf(complete({ responseDeadline: '2026-10-25' }), '2026-10-26'),
    ).toBeNull();
  });

  it('конфиденциальность и приложенные письма (#461): флаг всегда, строки — при наличии', () => {
    const withRows = complete({
      confidential: true,
      attachedRefs: [
        {
          number: ' 456 ',
          counterparty: { id: 'd0000000-0000-4000-8000-000000000001', name: 'АО «Галургия»' },
          date: '2026-10-01',
        },
        // Строка без контрагента в тело не уходит (схема требует контрагента).
        { number: '78', counterparty: null, date: null },
      ],
    });
    const body = registrationInputOf(withRows, '2026-10-26');
    expect(body?.confidential).toBe(true);
    expect(body?.attachedRefs).toEqual([
      {
        number: '456',
        counterpartyId: 'd0000000-0000-4000-8000-000000000001',
        date: '2026-10-01',
      },
    ]);
    // Пустой набор — ключа нет (тело не раздувается).
    expect(registrationInputOf(complete(), '2026-10-26')).not.toHaveProperty('attachedRefs');
  });

  it('подтверждение подсказки «ответ на» (#56, Р5): уходит в тело только с галочкой', () => {
    const suggested = {
      id: '70000000-0000-4000-8000-000000000030',
      regNumber: 'Исх-2026/1',
      subject: 'Оферта',
    };
    const draft = complete({ suggestedReply: suggested });
    // Без галочки связи нет — Вика подтверждает сама.
    expect(registrationInputOf(draft, '2026-10-26')).not.toHaveProperty('replyToLetterId');
    const linked = registrationInputOf(
      complete({ suggestedReply: suggested, linkReply: true }),
      '2026-10-26',
    );
    if (!linked) throw new Error('с галочкой связи тело регистрации ожидается не пустым');
    expect(linked.replyToLetterId).toBe(suggested.id);
    // Подсказка берётся из карточки письма при монтировании формы.
    expect(initialDraft(letter, METHODS).linkReply).toBe(false);
    expect(
      initialDraft({ ...letter, replySuggestion: suggested } as LetterDetail, METHODS)
        .suggestedReply,
    ).toBe(suggested);
  });

  it('ввод из самого письма (редизайн #56): всё обязательное заполнено в карточке — готов; пропуск — null, нужен контроль окна', () => {
    const filled = {
      ...letter,
      counterparty: { id: '00000000-0000-4000-8000-000000000001', name: 'АО «Галургия»' },
      theirNumber: '0359-КЖ/152',
      theirDate: '2026-10-25',
      addressee: {
        id: '00000000-0000-4000-8000-000000000007',
        displayName: 'Валерия Шайдерова',
        avatarUrl: null,
      },
    } as LetterDetail;
    const input = letterRegistrationInput(filled, METHODS);
    expect(input).not.toBeNull();
    expect(input?.counterpartyId).toBe(filled.counterparty!.id);
    expect(input?.addresseeId).toBe(filled.addressee!.id);
    expect(input?.receiptMethodId).toBe(METHODS[0]!.id);
    // Что-то обязательное пусто (адресат не выбран по месту) — без окна нельзя.
    expect(letterRegistrationInput(letter, METHODS)).toBeNull();
    expect(
      letterRegistrationInput({ ...filled, addressee: null } as LetterDetail, METHODS),
    ).toBeNull();
  });

  it('пропуск «основной документ» (#56): кандидаты без звезды — окно контроля', () => {
    const candidate = {
      id: '00000000-0000-4000-8000-0000000000a1',
      fileId: '00000000-0000-4000-8000-0000000000a1',
      role: 'attachment',
      name: 'Скан.pdf',
      mime: 'application/pdf',
      size: 100,
      contentId: null,
      inline: false,
      url: '/f',
      pdfUrl: null,
      previewKind: 'pdf',
    } as LetterDetail['attachments'][number];
    const filled2 = {
      ...letter,
      counterparty: { id: '00000000-0000-4000-8000-000000000001', name: 'АО «Галургия»' },
      theirNumber: '0359-КЖ/152',
      theirDate: '2026-10-25',
      addressee: { id: '00000000-0000-4000-8000-000000000007', displayName: 'В', avatarUrl: null },
      attachments: [candidate],
      body: { kind: 'none' },
    } as unknown as LetterDetail;
    // Все поля заполнены, но звезда не выбрана — прямая регистрация не идёт.
    expect(letterRegistrationInput(filled2, METHODS)).toBeNull();
    const chosen = {
      ...filled2,
      body: { kind: 'document', attachmentId: candidate.id },
    } as LetterDetail;
    expect(letterRegistrationInput(chosen, METHODS)).not.toBeNull();
  });
});

describe('даты ДД.ММ.ГГГГ (#55)', () => {
  it('разбирает ввод с клавиатуры в разных записях', () => {
    expect(parseRuDate('25.10.2026')).toBe('2026-10-25');
    expect(parseRuDate('5.1.26')).toBe('2026-01-05');
    expect(parseRuDate('25/10/2026')).toBe('2026-10-25');
    expect(parseRuDate('25102026')).toBe('2026-10-25');
    expect(parseRuDate('251026')).toBe('2026-10-25');
  });

  it('несуществующий день и мусор — null; ISO → ДД.ММ.ГГГГ без сдвига пояса', () => {
    expect(parseRuDate('31.02.2026')).toBeNull();
    expect(parseRuDate('завтра')).toBeNull();
    expect(formatIsoDate('2026-10-25')).toBe('25.10.2026');
    expect(formatIsoDate(null)).toBe('');
  });
});
