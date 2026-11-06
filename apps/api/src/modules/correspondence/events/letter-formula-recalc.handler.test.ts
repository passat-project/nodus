import { describe, expect, it, vi } from 'vitest';

import {
  LetterFormulaDefinitionHandler,
  LetterFormulaRecalcHandler,
  LetterFormulaRegisteredHandler,
} from './letter-formula-recalc.handler.js';

/**
 * #632 (Р4/Р8/Р13): пересчёт формул писем по событиям — значения атрибутов
 * (`cf.<id>`), системные поля и регистрация (события хоста), значение
 * компании и удаление атрибута (каталог `custom_field.definition_changed`).
 */

const LETTER = '63200000-0000-4000-8000-000000000301';
const FIELD = '63200000-0000-4000-8000-000000000302';
const TYPE = '63200000-0000-4000-8000-000000000303';

const logger = () => ({
  setContext: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

function event(type: string, payload: Record<string, unknown>, actorId: string | null = null) {
  return {
    id: 'evt-1',
    type,
    actorId,
    payload,
    createdAt: '2026-11-06T00:00:00.000Z',
  };
}

function setup() {
  const formulas = { recalcCells: vi.fn(async () => void 0) };
  const cells = {
    numberByDefinitionId: vi.fn(async () => 7),
    depthOf: vi.fn(async () => 2),
    dependentCellsByAttrNumber: vi.fn(async () => [
      { cellId: 'c1', hostKind: 'letter', hostId: LETTER, fieldId: FIELD },
      {
        cellId: 'c2',
        hostKind: 'task',
        hostId: '63200000-0000-4000-8000-000000000304',
        fieldId: FIELD,
      },
    ]),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  return { formulas, cells, txRunner };
}

describe('LetterFormulaRecalcHandler: letter_updated (#632, Р4)', () => {
  it('изменение атрибута — пересчёт с глубиной источника + 1', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaRecalcHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('correspondence.letter_updated', {
        letterId: LETTER,
        changes: [{ field: `cf.${FIELD}`, from: null, to: 1 }],
      }),
    );
    expect(cells.numberByDefinitionId).toHaveBeenCalledWith(FIELD, {});
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [7], 3);
  });

  it('системное поле (тема) — пересчёт ячеек письма без номеров атрибутов', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaRecalcHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('correspondence.letter_updated', {
        letterId: LETTER,
        changes: [{ field: 'subject', from: 'A', to: 'B' }],
      }),
    );
    expect(cells.numberByDefinitionId).not.toHaveBeenCalled();
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [], 1);
  });

  it('ключ не-uuid и невалидный payload игнорируются', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaRecalcHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('correspondence.letter_updated', {
        letterId: LETTER,
        changes: [{ field: 'cf.не-uuid', from: null, to: 1 }],
      }),
    );
    await handler.handle(event('correspondence.letter_updated', { letterId: 'не-uuid' }));
    expect(cells.numberByDefinitionId).not.toHaveBeenCalled();
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
  });
});

describe('LetterFormulaRegisteredHandler: letter_registered (#632, Р4)', () => {
  it('регистрация пишет реквизиты без letter_updated — ячейки пересчитываются', async () => {
    const { formulas, txRunner } = setup();
    const handler = new LetterFormulaRegisteredHandler(
      txRunner as never,
      formulas as never,
      logger() as never,
    );
    await handler.handle(
      event('correspondence.letter_registered', {
        letterId: LETTER,
        typeId: TYPE,
        direction: 'incoming',
        regNumber: 'Вх-2026/1',
        registeredAt: '2026-11-06T08:00:00.000Z',
        counterpartyId: '63200000-0000-4000-8000-000000000305',
        signerId: null,
        addresseeId: '63200000-0000-4000-8000-000000000306',
        registrarId: '63200000-0000-4000-8000-000000000307',
        projectId: null,
      }),
    );
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [], 1);
  });
});

describe('LetterFormulaDefinitionHandler: definition_changed (#632, Р13)', () => {
  it('удаление атрибута — пересчёт писем с зависимостями, только хосты letter', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaDefinitionHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('custom_field.definition_changed', { definitionId: FIELD, change: 'deleted' }),
    );
    expect(cells.dependentCellsByAttrNumber).toHaveBeenCalledWith(7);
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [7], 1);
  });

  it('переименование без companyValue — пересчёта нет', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaDefinitionHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('custom_field.definition_changed', {
        definitionId: FIELD,
        change: 'updated',
        fields: ['name'],
      }),
    );
    expect(cells.dependentCellsByAttrNumber).not.toHaveBeenCalled();
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });

  it('смена значения компании — массовый пересчёт (companyValue)', async () => {
    const { formulas, txRunner } = setup();
    const handler = new LetterFormulaDefinitionHandler(
      txRunner as never,
      formulas as never,
      { ...setup().cells } as never,
      logger() as never,
    );
    await handler.handle(
      event('custom_field.definition_changed', {
        definitionId: FIELD,
        change: 'updated',
        fields: ['companyValue'],
      }),
    );
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [7], 1);
  });
});
