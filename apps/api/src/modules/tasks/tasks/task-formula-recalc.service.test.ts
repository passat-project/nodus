import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';

import { TaskFormulaRecalcService } from './task-formula-recalc.service.js';
import type { FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import type { TaskFieldsWriter } from './task-fields.writer.js';

const TASK = '63200000-0000-4000-8000-000000000301';
const FIELD = '63200000-0000-4000-8000-000000000306';

function setup() {
  const repo = {
    lock: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => ({
      id: TASK,
      creatorId: 'creator',
      assigneeId: 'assignee',
      participants: [],
    })),
  };
  const writer = { apply: vi.fn(async () => ({ customFieldChanges: [] })) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const cells = {
    recalc: vi.fn(async () => ({
      value: 5,
      error: null,
      changed: true,
      errorChanged: false,
      silent: false,
    })),
  };
  const service = new TaskFormulaRecalcService(
    repo as never,
    writer as never as TaskFieldsWriter,
    eventBus as never,
    cells as never as FormulaCells,
  );
  return { service, cells, writer };
}

describe('TaskFormulaRecalcService: изоляция сбоя ячейки (A3-07, I5)', () => {
  const cell = (id: string) => ({
    cellId: id,
    hostKind: 'task' as const,
    hostId: TASK,
    fieldId: FIELD,
  });

  it('падение пересчёта одной ячейки не валит партию: остальные обработаны', async () => {
    const { service, cells, writer } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    cells.recalc.mockRejectedValueOnce(new Error('источник недоступен'));
    await expect(
      service.recalcOwn({} as never, null, TASK, [cell('c1'), cell('c2')], 1),
    ).resolves.toBeUndefined();
    expect(cells.recalc).toHaveBeenCalledTimes(2);
    expect(writer.apply).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
