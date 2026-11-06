import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { LetterFormApplier } from './letter-form.applier.js';
import type { LetterDetailRow } from '../letters/letter-row.js';

const UUID = '00000000-0000-4000-8000-0000000000e1';

const row = {
  id: UUID,
  typeId: 'type-1',
  counterpartyId: null,
  signerId: null,
  theirNumber: null,
  theirDate: null,
  subject: null,
  receiptMethodId: null,
  projectId: null,
  addresseeId: null,
  responseDeadline: null,
  customFields: {},
} as unknown as LetterDetailRow;

const registration = {
  counterpartyId: '00000000-0000-4000-8000-000000000011',
  signerId: null,
  theirNumber: '123',
  theirDate: '2026-10-28',
  subject: 'Тема',
  receiptMethodId: '00000000-0000-4000-8000-000000000012',
  projectId: null,
  addresseeId: '00000000-0000-4000-8000-000000000013',
  responseDeadline: null,
  replyToLetterId: null,
};

function applierWith(attachments: { id: string; role: string; inline: boolean }[]) {
  const repo = {
    attachments: vi.fn(async () => attachments),
    update: vi.fn(async () => undefined),
    linkReplyTo: vi.fn(),
  };
  const validator = {
    registration: vi.fn(async () => ({
      values: registration,
      extra: { confidential: null, attachedRefs: null },
      customFields: {},
    })),
  };
  const attached = { replace: vi.fn(async () => void 0) };
  const fields = { releaseFormulas: vi.fn(async () => void 0) };
  const applier = new LetterFormApplier(
    repo as never,
    validator as never,
    fields as never,
    {} as never,
    attached as never,
    { validate: vi.fn(async () => []) } as never,
  );
  return { applier, repo, validator, fields };
}

describe('регистрация требует основной документ («Основной документ письма» #56)', () => {
  it('файлы-кандидаты без выбора — 422 с пропуском mainDocument', async () => {
    const { applier } = applierWith([{ id: 'a1', role: 'attachment', inline: false }]);
    await expect(
      applier.apply({} as never, row, { id: 'u', permissions: [] }, { registration: {} }),
    ).rejects.toMatchObject({
      code: ErrorCode.LETTER_REGISTRATION_INVALID,
      details: { field: 'mainDocument', reason: 'required' },
    });
  });

  it('главный выбран (main или PDF-копия тела) — регистрация идёт', async () => {
    const withMain = applierWith([
      { id: 'a1', role: 'attachment', inline: false },
      { id: 'm1', role: 'main', inline: false },
    ]);
    await expect(
      withMain.applier.apply({} as never, row, { id: 'u', permissions: [] }, { registration: {} }),
    ).resolves.toBeDefined();
    const withBodyPdf = applierWith([{ id: 'p1', role: 'body_pdf', inline: false }]);
    await expect(
      withBodyPdf.applier.apply(
        {} as never,
        row,
        { id: 'u', permissions: [] },
        { registration: {} },
      ),
    ).resolves.toBeDefined();
  });

  it('текст письма и исходник — не кандидаты: без файлов регистрация без пропуска', async () => {
    const { applier, repo } = applierWith([
      { id: 'b1', role: 'body', inline: false },
      { id: 's1', role: 'source', inline: false },
      { id: 'i1', role: 'attachment', inline: true },
    ]);
    await applier.apply({} as never, row, { id: 'u', permissions: [] }, { registration: {} });
    expect(repo.update).toHaveBeenCalled();
  });

  it('ошибка — DomainException (фильтр даёт 422)', async () => {
    const { applier } = applierWith([{ id: 'a1', role: 'attachment', inline: false }]);
    const error = await applier
      .apply({} as never, row, { id: 'u', permissions: [] }, { registration: {} })
      .catch((e) => e);
    expect(error).toBeInstanceOf(DomainException);
  });
});

describe('значения атрибутов, поставленные до регистрации (#646)', () => {
  it('текущие значения письма уходят базой в окно регистрации', async () => {
    const { applier, validator } = applierWith([]);
    const letter = {
      ...row,
      customFields: { 'field-a': 'поставлено PATCH' },
    } as unknown as LetterDetailRow;
    await applier.apply({} as never, letter, { id: 'u', permissions: [] }, { registration: {} });
    expect(validator.registration).toHaveBeenCalledWith(
      letter.typeId,
      {},
      { id: 'u', permissions: [] },
      expect.any(String),
      { 'field-a': 'поставлено PATCH' },
    );
  });
});

describe('формулы ячеек в окне регистрации (#632, Р5)', () => {
  it('вписанные в окно значения снимают формулу, умолчания — нет', async () => {
    const { applier, fields } = applierWith([{ id: 'm1', role: 'main', inline: false }]);
    const fieldId = '00000000-0000-4000-8000-0000000000e4';
    await applier.apply(
      {} as never,
      row,
      { id: 'u', permissions: [] },
      { registration: { customFields: { [fieldId]: 'вписано' } } },
    );
    expect(fields.releaseFormulas).toHaveBeenCalledWith(expect.anything(), row.id, [fieldId]);
  });

  it('окно без атрибутов формулу не трогает', async () => {
    const { applier, fields } = applierWith([{ id: 'm1', role: 'main', inline: false }]);
    await applier.apply({} as never, row, { id: 'u', permissions: [] }, { registration: {} });
    expect(fields.releaseFormulas).toHaveBeenCalledWith(expect.anything(), row.id, []);
  });
});

describe('подсказка «ответ на» (#461, Р4): невидимое = отсутствующее', () => {
  it('невидимая конфиденциальная подсказка даёт suggestion_mismatch, не not_found', async () => {
    const visibleTarget = '00000000-0000-4000-8000-0000000000e2';
    const secret = '00000000-0000-4000-8000-0000000000e3';
    const repo = {
      attachments: vi.fn(async () => []),
      update: vi.fn(async () => undefined),
      hasReplyTo: vi.fn(async () => false),
      replyTargetById: vi.fn(async () => ({
        id: visibleTarget,
        direction: 'outgoing',
        registeredAt: new Date('2026-10-01T08:00:00Z'),
        confidential: false,
        registrarId: null,
        addresseeId: null,
      })),
      findDetailById: vi.fn(async (id: string) =>
        id === secret
          ? {
              id,
              registeredAt: new Date('2026-10-01T08:00:00Z'),
              confidential: true,
              registrarId: 'other',
              addresseeId: null,
              deletedAt: null,
            }
          : {
              id,
              registeredAt: new Date('2026-10-01T08:00:00Z'),
              confidential: false,
              registrarId: null,
              addresseeId: null,
              deletedAt: null,
            },
      ),
      participants: vi.fn(async () => []),
      linkReplyTo: vi.fn(async () => true),
    };
    const validator = {
      registration: vi.fn(async () => ({
        values: { ...registration, replyToLetterId: visibleTarget },
        extra: { confidential: null, attachedRefs: null },
        customFields: {},
      })),
    };
    const threading = {
      suggestionBySubject: vi.fn(async () => ({
        id: secret,
        regNumber: 'Исх-2026/9',
        subject: 'Секрет',
      })),
    };
    const applier = new LetterFormApplier(
      repo as never,
      validator as never,
      { releaseFormulas: vi.fn(async () => void 0) } as never,
      threading as never,
      { replace: vi.fn() } as never,
      { validate: vi.fn(async () => []) } as never,
    );
    await expect(
      applier.apply(
        {} as never,
        row,
        { id: 'u', permissions: [Permission.CORRESPONDENCE_REGISTER] },
        { registration: {} },
      ),
    ).rejects.toMatchObject({ details: { reason: 'suggestion_mismatch' } });
    expect(repo.linkReplyTo).not.toHaveBeenCalled();
  });
});
