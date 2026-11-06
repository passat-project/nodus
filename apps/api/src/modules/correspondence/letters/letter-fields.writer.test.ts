import { describe, expect, it, vi } from 'vitest';

import { LetterFieldsWriter, letterAudience } from './letter-fields.writer.js';
import type { LetterDetailRow } from './letter-row.js';

/**
 * #632 (Р4/Р5): писатель значений письма — ручная запись снимает формулу
 * ячейки, запись результата формулы идёт через реестр (`trusted`) и эмитит
 * событие хоста только при реальном изменении (шум-контроль каскада, Р8).
 */

const LETTER = '63200000-0000-4000-8000-000000000101';
const TYPE = '63200000-0000-4000-8000-000000000102';
const FIELD = '63200000-0000-4000-8000-000000000103';
const AUTHOR = '63200000-0000-4000-8000-000000000104';
const REGISTRAR = '63200000-0000-4000-8000-000000000105';
const ADDRESSEE = '63200000-0000-4000-8000-000000000106';

function row(overrides: Partial<LetterDetailRow> = {}): LetterDetailRow {
  return {
    id: LETTER,
    typeId: TYPE,
    customFields: {},
    deletedAt: null,
    createdBy: AUTHOR,
    registrarId: REGISTRAR,
    addresseeId: ADDRESSEE,
    ...overrides,
  } as unknown as LetterDetailRow;
}

function setup(letter: LetterDetailRow = row(), prepared?: { next: object; changes: unknown[] }) {
  const repo = {
    lock: vi.fn(async () => void 0),
    findDetailById: vi.fn(async () => letter),
    update: vi.fn(async () => void 0),
  };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const registry = {
    prepareUpdate: vi.fn(
      async () =>
        prepared ?? { next: { [FIELD]: 42 }, changes: [{ fieldId: FIELD, from: null, to: 42 }] },
    ),
  };
  const formulaCells = { release: vi.fn(async () => void 0) };
  const writer = new LetterFieldsWriter(
    repo as never,
    eventBus as never,
    registry as never,
    formulaCells as never,
  );
  return { writer, repo, eventBus, registry, formulaCells };
}

describe('LetterFieldsWriter: ручная запись снимает формулу (Р5)', () => {
  it('release зовётся с видом хоста letter и ключами патча', async () => {
    const { writer, formulaCells } = setup();
    await writer.releaseFormulas({} as never, LETTER, [FIELD]);
    expect(formulaCells.release).toHaveBeenCalledWith({}, 'letter', LETTER, [FIELD]);
  });

  it('пустой список ключей репозиторий ячеек не дёргает', async () => {
    const { writer, formulaCells } = setup();
    await writer.releaseFormulas({} as never, LETTER, []);
    expect(formulaCells.release).not.toHaveBeenCalled();
  });
});

describe('LetterFieldsWriter: материализация значения формулы (Р4)', () => {
  it('пишет через реестр trusted и эмитит событие письма с ключом cf.<id>', async () => {
    const { writer, repo, eventBus, registry } = setup();
    const changes = await writer.applyFormulaValues({} as never, {
      letterId: LETTER,
      values: { [FIELD]: 42 },
      actorId: null,
    });
    expect(changes).toHaveLength(1);
    expect(registry.prepareUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { [FIELD]: 42 },
        target: { kind: 'process_type', id: TYPE },
        trusted: true,
      }),
      {},
    );
    expect(repo.lock).toHaveBeenCalledWith({}, LETTER);
    expect(repo.update).toHaveBeenCalledWith({}, LETTER, { customFields: { [FIELD]: 42 } });
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      'correspondence.letter_updated',
      { letterId: LETTER, changes: [{ field: `cf.${FIELD}`, from: null, to: 42 }] },
      expect.objectContaining({ aggregateType: 'letter', aggregateId: LETTER }),
    );
  });

  it('значение не изменилось — ни записи, ни события (гашение каскада, Р8)', async () => {
    const { writer, repo, eventBus } = setup(row(), { next: {}, changes: [] });
    await writer.applyFormulaValues({} as never, {
      letterId: LETTER,
      values: { [FIELD]: 42 },
      actorId: null,
    });
    expect(repo.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('надгробие письма: значение не пишется и событий нет', async () => {
    const { writer, repo, eventBus } = setup(
      row({ deletedAt: new Date('2026-11-06T10:00:00.000Z') }),
    );
    await writer.applyFormulaValues({} as never, {
      letterId: LETTER,
      values: { [FIELD]: 42 },
      actorId: null,
    });
    expect(repo.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('пустой набор значений — ранний выход без замка строки', async () => {
    const { writer, repo } = setup();
    await writer.applyFormulaValues({} as never, { letterId: LETTER, values: {}, actorId: null });
    expect(repo.lock).not.toHaveBeenCalled();
  });
});

describe('letterAudience (O4): круг видимости письма', () => {
  it('участники обсуждения + регистратор + адресат + автор, без повторов', () => {
    const ids = letterAudience(row(), [ADDRESSEE, '63200000-0000-4000-8000-000000000107']);
    expect(ids).toEqual([ADDRESSEE, '63200000-0000-4000-8000-000000000107', REGISTRAR, AUTHOR]);
  });
});
