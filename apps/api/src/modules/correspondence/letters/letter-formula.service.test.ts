import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission, type AuthUser } from '@nodus/contracts';

import type { FormulaCellRef } from '../../custom-fields/ports/formula-cells.port.js';
import { LetterFormulaService } from './letter-formula.service.js';
import type { LetterDetailRow } from './letter-row.js';

/**
 * #632 (Р10/Р4): мутации формулы ячейки живут у владельца хоста — право
 * canEdit письма (канцелярия), значение материализует писатель письма,
 * событие формулы уходит адресно видимым письмо.
 */

const LETTER = '63200000-0000-4000-8000-000000000201';
const FIELD = '63200000-0000-4000-8000-000000000202';
const REGISTRAR = {
  id: '63200000-0000-4000-8000-000000000203',
  displayName: 'Канцелярия',
  permissions: [Permission.CORRESPONDENCE_REGISTER],
} as unknown as AuthUser;
const EMPLOYEE = {
  id: '63200000-0000-4000-8000-000000000204',
  displayName: 'Сотрудник',
  permissions: [],
} as unknown as AuthUser;

const AST = {
  kind: 'field',
  number: 1,
  name: 'Марка',
  source: { kind: 'self' },
} as never;

const row = {
  id: LETTER,
  typeId: '63200000-0000-4000-8000-000000000205',
  registeredAt: new Date('2026-11-06T08:00:00.000Z'),
  systemState: 'active',
  addresseeId: null,
  registrarId: REGISTRAR.id,
  confidential: false,
  createdBy: REGISTRAR.id,
  customFields: {},
  deletedAt: null,
} as unknown as LetterDetailRow;

function setup(options: { visible?: boolean } = {}) {
  const query = {
    visibleRow: vi.fn(async () => {
      if (options.visible === false) {
        throw Object.assign(new Error('not found'), { code: ErrorCode.NOT_FOUND });
      }
      return row;
    }),
  };
  const repo = {
    lock: vi.fn(async () => void 0),
    findDetailById: vi.fn(async () => row),
    participants: vi.fn(async () => [{ userId: REGISTRAR.id, role: 'member' }]),
  };
  const fields = { applyFormulaValues: vi.fn(async () => []) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const cells = {
    read: vi.fn(async () => ({ ast: null, origin: null })),
    save: vi.fn(async () => ({ value: 'результат', error: null })),
    remove: vi.fn(async () => void 0),
    dependentCellsByValues: vi.fn(async (): Promise<FormulaCellRef[]> => []),
    cellsForHost: vi.fn(async (): Promise<FormulaCellRef[]> => [
      { cellId: 'c1', hostKind: 'letter', hostId: LETTER, fieldId: FIELD },
    ]),
    recalc: vi.fn(async () => ({ value: 'новое', error: null, changed: true, silent: false })),
  };
  const service = new LetterFormulaService(
    { run: (fn: (tx: unknown) => unknown) => fn({}) } as never,
    query as never,
    repo as never,
    fields as never,
    eventBus as never,
    cells as never,
  );
  return { service, query, repo, fields, eventBus, cells };
}

describe('LetterFormulaService (#632, Р10)', () => {
  it('чтение формулы — любому зрителю письма, без права правки', async () => {
    const { service, cells } = setup();
    await service.read(EMPLOYEE, LETTER, FIELD);
    expect(cells.read).toHaveBeenCalledWith('letter', LETTER, FIELD);
  });

  it('невидимое письмо — 404 без оракула (ячейки не читаются)', async () => {
    const { service, cells } = setup({ visible: false });
    await expect(service.read(EMPLOYEE, LETTER, FIELD)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(cells.read).not.toHaveBeenCalled();
  });

  it('сохранение: формула + значение писателем письма + адресное событие', async () => {
    const { service, fields, eventBus, cells } = setup();
    const result = await service.save(REGISTRAR, LETTER, FIELD, AST);
    expect(result).toEqual({ ast: AST, origin: 'own' });
    expect(cells.save).toHaveBeenCalledWith(
      {},
      { hostKind: 'letter', hostId: LETTER, fieldId: FIELD, ast: AST, actorId: REGISTRAR.id },
    );
    expect(fields.applyFormulaValues).toHaveBeenCalledWith(
      {},
      {
        letterId: LETTER,
        values: { [FIELD]: 'результат' },
        actorId: REGISTRAR.id,
      },
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      'custom_field.formula_changed',
      {
        hostKind: 'letter',
        hostId: LETTER,
        fieldId: FIELD,
        hasError: false,
        audience: expect.arrayContaining([REGISTRAR.id]),
      },
      expect.objectContaining({ aggregateType: 'letter', aggregateId: LETTER }),
    );
  });

  it('сохранять формулу может только правящий письмо: сотруднику — 403', async () => {
    const { service, cells } = setup();
    await expect(service.save(EMPLOYEE, LETTER, FIELD, AST)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(cells.save).not.toHaveBeenCalled();
  });

  it('ошибка вычисления не блокирует сохранение, событие несёт hasError', async () => {
    const { service, eventBus, cells } = setup();
    cells.save.mockResolvedValueOnce({
      value: null,
      error: { code: 'division_by_zero', message: 'деление на ноль' },
    } as never);
    await service.save(REGISTRAR, LETTER, FIELD, AST);
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      'custom_field.formula_changed',
      expect.objectContaining({ hasError: true }),
      expect.anything(),
    );
  });

  it('пересчёт: изменившееся значение пишется, неизменившееся — молчит (Р8)', async () => {
    const { service, fields, eventBus, cells } = setup();
    cells.recalc
      .mockResolvedValueOnce({ value: 'новое', error: null, changed: true, silent: false })
      .mockResolvedValueOnce({ value: 'старое', error: null, changed: false, silent: false });
    cells.cellsForHost.mockResolvedValueOnce([
      { cellId: 'c1', hostKind: 'letter', hostId: LETTER, fieldId: FIELD },
      {
        cellId: 'c2',
        hostKind: 'letter',
        hostId: LETTER,
        fieldId: '63200000-0000-4000-8000-000000000206',
      },
    ]);
    await service.recalcCells({} as never, null, LETTER, [], 1);
    expect(fields.applyFormulaValues).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('пересчёт не пишет в чужой хост (I3)', async () => {
    const { service, fields, cells } = setup();
    cells.dependentCellsByValues.mockResolvedValueOnce([
      {
        cellId: 'x',
        hostKind: 'task',
        hostId: '63200000-0000-4000-8000-000000000207',
        fieldId: FIELD,
      },
    ]);
    cells.cellsForHost.mockResolvedValueOnce([]);
    await service.recalcCells({} as never, null, LETTER, [1], 1);
    expect(fields.applyFormulaValues).not.toHaveBeenCalled();
  });
});
