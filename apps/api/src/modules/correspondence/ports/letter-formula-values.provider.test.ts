import { describe, expect, it, vi } from 'vitest';
import { Permission } from '@nodus/contracts';

import { LetterFormulaValuesProvider } from './letter-formula-values.provider.js';
import type { LetterDetailRow } from '../letters/letter-row.js';

/**
 * #632 (Р7/Р11): письмо-источник отдаёт значения атрибутов и системные поля
 * в языке формул; невидимое актору письмо и надгробие спама источником не
 * бывают (404 без оракула, В1).
 */

const LETTER = '63200000-0000-4000-8000-000000000001';
const TYPE = '63200000-0000-4000-8000-000000000002';
const PROJECT = '63200000-0000-4000-8000-000000000003';
const REGISTRAR = '63200000-0000-4000-8000-000000000004';
const ADDRESSEE = '63200000-0000-4000-8000-000000000005';
const OUTSIDER = '63200000-0000-4000-8000-000000000006';

function row(overrides: Partial<LetterDetailRow> = {}): LetterDetailRow {
  return {
    id: LETTER,
    typeId: TYPE,
    projectId: PROJECT,
    counterpartyId: '63200000-0000-4000-8000-000000000007',
    subject: 'О поставке',
    regNumber: 'Вх-2026/118',
    regDate: new Date('2026-11-06T00:00:00.000Z'),
    receivedAt: new Date('2026-11-05T09:30:00.000Z'),
    theirNumber: '45/7',
    theirDate: new Date('2026-11-01T00:00:00.000Z'),
    customFields: { 'field-a': 'значение' },
    confidential: false,
    registrarId: REGISTRAR,
    addresseeId: ADDRESSEE,
    createdBy: REGISTRAR,
    deletedAt: null,
    ...overrides,
  } as unknown as LetterDetailRow;
}

function setup(letter: LetterDetailRow | null, participants: string[] = []) {
  const letters = {
    findDetailById: vi.fn(async () => letter),
    participants: vi.fn(async () => participants.map((userId) => ({ userId, role: 'member' }))),
  };
  const provider = new LetterFormulaValuesProvider(letters as never);
  return { provider, letters };
}

describe('LetterFormulaValuesProvider (#632, Р11)', () => {
  it('значения и системные поля письма в типах языка формул', async () => {
    const { provider } = setup(row());
    const record = await provider.record(LETTER);
    expect(record).toMatchObject({
      kind: 'letter',
      id: LETTER,
      values: { 'field-a': 'значение' },
      projectId: PROJECT,
      parentId: null,
      nodeId: null,
      // Место записи — тип процесса письма (формула привязки типа, Р6).
      placeId: TYPE,
      confidential: false,
    });
    expect(record?.system).toEqual({
      subject: 'О поставке',
      regNumber: 'Вх-2026/118',
      // Дата — ISO-день (грамматика `date`), время — ISO 8601 UTC (I7).
      regDate: '2026-11-06',
      receivedAt: '2026-11-05T09:30:00.000Z',
      correspondent: '63200000-0000-4000-8000-000000000007',
      theirNumber: '45/7',
      theirDate: '2026-11-01',
    });
  });

  it('незаполненные системные поля — пусто (null), не ошибка', async () => {
    const { provider } = setup(
      row({
        regNumber: null,
        regDate: null,
        subject: null,
        counterpartyId: null,
        theirNumber: null,
        theirDate: null,
      }),
    );
    const record = await provider.record(LETTER);
    expect(record?.system).toMatchObject({
      subject: null,
      regNumber: null,
      regDate: null,
      correspondent: null,
      theirNumber: null,
      theirDate: null,
    });
  });

  it('надгробие спама источником не бывает', async () => {
    const { provider } = setup(row({ deletedAt: new Date('2026-11-06T10:00:00.000Z') }));
    await expect(provider.record(LETTER)).resolves.toBeNull();
  });

  it('конфиденциальное письмо: посторонний — null, участник — запись (Р7/В1)', async () => {
    const letter = row({ confidential: true });
    const outsider = setup(letter, []);
    await expect(
      outsider.provider.record(LETTER, { actor: { id: OUTSIDER, permissions: [] } }),
    ).resolves.toBeNull();
    expect(outsider.letters.participants).toHaveBeenCalledWith(LETTER, undefined);

    const member = setup(letter, [OUTSIDER]);
    await expect(
      member.provider.record(LETTER, { actor: { id: OUTSIDER, permissions: [] } }),
    ).resolves.not.toBeNull();

    const privileged = setup(letter, []);
    await expect(
      privileged.provider.record(LETTER, {
        actor: { id: OUTSIDER, permissions: [Permission.CORRESPONDENCE_VIEW_CONFIDENTIAL] },
      }),
    ).resolves.not.toBeNull();
  });

  it('обычное зарегистрированное письмо видно всем вошедшим без чтения состава', async () => {
    const { provider, letters } = setup(row());
    await expect(
      provider.record(LETTER, { actor: { id: OUTSIDER, permissions: [] } }),
    ).resolves.not.toBeNull();
    expect(letters.participants).not.toHaveBeenCalled();
  });

  it('незарегистрированное письмо чужому — null (очередь «Новые»)', async () => {
    const letter = row({ registeredAt: null, regNumber: null, regDate: null });
    const { provider } = setup(letter);
    await expect(
      provider.record(LETTER, { actor: { id: OUTSIDER, permissions: [] } }),
    ).resolves.toBeNull();
    await expect(
      provider.record(LETTER, {
        actor: { id: OUTSIDER, permissions: [Permission.CORRESPONDENCE_REGISTER] },
      }),
    ).resolves.not.toBeNull();
  });
});
