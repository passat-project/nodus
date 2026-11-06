import { ErrorCode, SystemDictionary } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import { LetterFieldsValidator } from './letter-fields.validator.js';

const AUTHOR = { id: 'author', permissions: [] as string[] };
const TYPE_ID = '00000000-0000-4000-8000-000000000101';
const COUNTERPARTY_ID = '00000000-0000-4000-8000-000000000102';
const SIGNER_ID = '00000000-0000-4000-8000-000000000103';
const RECEIPT_ID = '00000000-0000-4000-8000-000000000104';
const ADDRESSEE_ID = '00000000-0000-4000-8000-000000000105';
const DICTIONARY_ID = '00000000-0000-4000-8000-000000000106';

function setup(overrides: { signer?: unknown; receipt?: unknown; active?: string[] } = {}) {
  const counterparties = {
    activeRef: vi.fn(async () => ({ id: COUNTERPARTY_ID, name: 'ООО «Галур»' })),
    activeContact: vi.fn(async () =>
      overrides.signer === null
        ? null
        : { id: SIGNER_ID, fullName: 'Иванов И. И.', position: null },
    ),
  };
  const dictionaries = {
    dictionaryIdByCode: vi.fn(async () => DICTIONARY_ID),
    activeItemRef: vi.fn(async () =>
      overrides.receipt === null
        ? null
        : { id: RECEIPT_ID, dictionaryId: DICTIONARY_ID, name: 'Почта', isActive: true },
    ),
  };
  const profiles = {
    filterActiveUserIds: vi.fn(async (ids: string[]) =>
      ids.filter((id) => (overrides.active ?? [ADDRESSEE_ID]).includes(id)),
    ),
  };
  const customFields = {
    prepareCreate: vi.fn(async () => ({})),
    prepareUpdate: vi.fn(async () => ({ next: {}, changes: [] })),
  };
  const projects = { assertProjectAttachable: vi.fn(async () => void 0) };
  const validator = new LetterFieldsValidator(
    counterparties as never,
    dictionaries as never,
    profiles as never,
    customFields as never,
    projects as never,
  );
  return { validator, counterparties, dictionaries, profiles, customFields };
}

const input = (patch: Record<string, unknown> = {}) => ({
  counterpartyId: COUNTERPARTY_ID,
  signerId: SIGNER_ID,
  theirNumber: '12/3',
  theirDate: '2026-10-01',
  subject: 'О согласовании',
  receiptMethodId: RECEIPT_ID,
  projectId: null,
  addresseeId: ADDRESSEE_ID,
  responseDeadline: null,
  ...patch,
});

describe('проверка регистрации письма (#55, Р1)', () => {
  it('значения черновика — база регистрации: окно перекрывает, чужие ключи живут (#646)', async () => {
    const { validator, customFields } = setup();
    const fieldA = '00000000-0000-4000-8000-0000000000d1';
    const fieldB = '00000000-0000-4000-8000-0000000000d2';
    await validator.registration(
      TYPE_ID,
      input({ customFields: { [fieldB]: 'из окна' } }),
      AUTHOR,
      '2026-10-27',
      { [fieldA]: 'поставлено раньше', [fieldB]: 'старое' },
    );
    expect(customFields.prepareCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { [fieldA]: 'поставлено раньше', [fieldB]: 'из окна' },
      }),
    );
  });

  it('валидный ввод: значения и атрибуты', async () => {
    const { validator } = setup();
    const result = await validator.registration(TYPE_ID, input(), AUTHOR, '2026-10-27');
    expect(result.values).toMatchObject({
      counterpartyId: COUNTERPARTY_ID,
      signerId: SIGNER_ID,
      subject: 'О согласовании',
    });
  });

  it('пустое обязательное поле — 422 required', async () => {
    const { validator } = setup();
    await expect(
      validator.registration(TYPE_ID, input({ subject: '' }), AUTHOR, '2026-10-27'),
    ).rejects.toMatchObject({
      code: ErrorCode.LETTER_REGISTRATION_INVALID,
      details: { field: 'subject', reason: 'required' },
    });
  });

  it('дата документа в будущем — 422 in_future; срок ответа в прошлом — in_past', async () => {
    const { validator } = setup();
    await expect(
      validator.registration(TYPE_ID, input({ theirDate: '2026-10-28' }), AUTHOR, '2026-10-27'),
    ).rejects.toMatchObject({ details: { field: 'theirDate', reason: 'in_future' } });
    await expect(
      validator.registration(
        TYPE_ID,
        input({ responseDeadline: '2026-10-26' }),
        AUTHOR,
        '2026-10-27',
      ),
    ).rejects.toMatchObject({ details: { field: 'responseDeadline', reason: 'in_past' } });
  });

  it('подписант не из контактов корреспондента — not_of_counterparty', async () => {
    const { validator } = setup({ signer: null });
    await expect(
      validator.registration(TYPE_ID, input(), AUTHOR, '2026-10-27'),
    ).rejects.toMatchObject({ details: { field: 'signerId', reason: 'not_of_counterparty' } });
  });

  it('архивный способ поступления — not_found', async () => {
    const { validator, dictionaries } = setup({ receipt: null });
    await expect(
      validator.registration(TYPE_ID, input(), AUTHOR, '2026-10-27'),
    ).rejects.toMatchObject({ details: { field: 'receiptMethodId', reason: 'not_found' } });
    expect(dictionaries.dictionaryIdByCode).toHaveBeenCalledWith(SystemDictionary.RECEIPT_METHOD);
  });

  it('уволенный адресат — inactive', async () => {
    const { validator } = setup({ active: [] });
    await expect(
      validator.registration(TYPE_ID, input(), AUTHOR, '2026-10-27'),
    ).rejects.toMatchObject({ details: { field: 'addresseeId', reason: 'inactive' } });
  });
});

describe('правка регистрационных данных (#55, В3)', () => {
  const current = {
    counterpartyId: COUNTERPARTY_ID,
    signerId: SIGNER_ID,
    theirNumber: '12/3',
    theirDate: '2026-10-01',
    subject: 'О согласовании',
    receiptMethodId: RECEIPT_ID,
    projectId: null,
    addresseeId: ADDRESSEE_ID,
    responseDeadline: null,
    // Связи «ответ на» правка не касается (#56) — поле для типа.
    replyToLetterId: null,
  };

  it('меняет только переданные поля и пишет изменения', async () => {
    const { validator } = setup();
    const { data, changes } = await validator.patch(
      current,
      {},
      { subject: 'Новая тема' },
      TYPE_ID,
      '2026-10-27',
      { id: 'u-registrar', permissions: [] },
    );
    expect(data).toEqual({ subject: 'Новая тема' });
    expect(changes).toEqual([{ field: 'subject', from: 'О согласовании', to: 'Новая тема' }]);
  });

  it('смена корреспондента сбрасывает чужого подписанта', async () => {
    const { validator, counterparties } = setup({ signer: null });
    const { changes } = await validator.patch(
      current,
      {},
      { counterpartyId: COUNTERPARTY_ID },
      TYPE_ID,
      '2026-10-27',
      { id: 'u-registrar', permissions: [] },
    );
    expect(changes).toContainEqual({ field: 'signerId', from: SIGNER_ID, to: null });
    expect(counterparties.activeContact).toHaveBeenCalled();
  });
});
