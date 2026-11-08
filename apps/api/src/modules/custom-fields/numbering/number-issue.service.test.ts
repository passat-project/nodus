import { describe, expect, it, vi } from 'vitest';
import type { NumberSeriesRule } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import type { NumberTarget } from '../ports/number-host.port.js';
import { NumberIssueService } from './number-issue.service.js';

/**
 * Движок выдачи (#630, модель v3): план проверяет ВСЕ номера действия до
 * выдачи — нет места счёта или пустое поле-вставка без подтверждения
 * отказывают, счётчик не тратится; подтверждённый номер выдаётся и
 * рендерится; «при создании» фильтрует типы и уже заполненные поля.
 */
const TX = {} as TransactionClient;
const FOLDER_KIND = '11111111-1111-4111-8111-111111111111';
const FIELD_ID = '22222222-2222-4222-8222-222222222222';
const TYPE_ID = '33333333-3333-4333-8333-333333333333';

const definition = (overrides: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow =>
  ({
    id: FIELD_ID,
    number: 5,
    type: 'counter',
    name: 'Изм.',
    numberSeriesId: 'series-1',
    bindings: [{ targetKind: 'process_type', targetId: TYPE_ID }],
    companyValue: null,
    ...overrides,
  }) as never;

const series = (rule: NumberSeriesRule) => ({
  id: 'series-1',
  name: 'Изм.',
  containers: rule.containers,
  period: rule.period,
  template: rule.template,
  startValue: rule.startValue,
  step: rule.step,
});

const target = (overrides: Partial<NumberTarget> = {}): NumberTarget => ({
  host: 'task',
  typeId: TYPE_ID,
  folders: [],
  projectId: null,
  portfolioId: null,
  projectTypeId: null,
  parentTaskId: null,
  sources: { self: {} },
  ...overrides,
});

const rule = (overrides: Partial<NumberSeriesRule> = {}): NumberSeriesRule => ({
  containers: [{ kind: 'folder', nodeKindId: FOLDER_KIND }],
  period: 'none',
  template: [{ kind: 'literal', text: 'Изм. ' }, { kind: 'counter' }],
  startValue: 1,
  step: 1,
  ...overrides,
});

function setup(rows: FieldDefinitionRow[], data = series(rule())) {
  const next = vi.fn(async () => ({
    seriesId: 'series-1',
    scopeKey: 'folder',
    hits: [],
    periodKey: '',
    year: 2026,
    seq: 3,
    display: 'Изм. 3',
    assignedAt: new Date('2026-11-08T10:00:00Z'),
  }));
  const service = new NumberIssueService(
    { list: vi.fn(async () => rows) } as never,
    {
      byId: vi.fn(async () => data),
      next,
    } as never,
    { findRefs: vi.fn(async () => []) } as never,
    { conditionName: vi.fn(async () => 'Комплект') } as never,
  );
  return { service, next };
}

describe('NumberIssueService (#630)', () => {
  it('нет папки вида — отказ missing, номер не выдан', async () => {
    const { service, next } = setup([definition()]);
    const plan = await service.plan(TX, [FIELD_ID], target(), {
      hostKind: 'task',
      source: 'create',
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.failure).toMatchObject({
        kind: 'missing',
        fieldId: FIELD_ID,
        fieldName: 'Изм.',
        reason: 'no_folder',
        name: 'Комплект',
      });
    }
    expect(next).not.toHaveBeenCalled();
  });

  it('папка есть — номер выдаётся в счёт значений условий', async () => {
    const { service, next } = setup([definition()]);
    const plan = await service.plan(
      TX,
      [FIELD_ID],
      target({ folders: [{ id: FOLDER_KIND, kindId: FOLDER_KIND }] }),
      { hostKind: 'task', source: 'create' },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    await expect(plan.issue(TX, 'task-1')).resolves.toEqual({ [FIELD_ID]: 'Изм. 3' });
    expect(next).toHaveBeenCalledWith(
      TX,
      'series-1',
      expect.objectContaining({
        hits: [{ entity: 'node', id: FOLDER_KIND }],
        host: expect.objectContaining({ kind: 'task', id: 'task-1', fieldId: FIELD_ID }),
      }),
    );
  });

  it('пустое поле-вставка — 409-план, подтверждение выдаёт номер без него', async () => {
    const emptyRule = rule({
      containers: [],
      template: [
        { kind: 'literal', text: '-' },
        { kind: 'field', fieldNumber: 7, source: 'self' },
        { kind: 'counter' },
      ],
    });
    const rows = [definition(), definition({ id: 'field-7', number: 7, name: 'Инв. №' })];
    const { service } = setup(rows, series(emptyRule));
    const blocked = await service.plan(TX, [FIELD_ID], target(), {
      hostKind: 'task',
      source: 'create',
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.failure).toMatchObject({
        kind: 'empty',
        segments: [{ fieldNumber: 7, source: 'self', name: 'Инв. №' }],
        example: '-1',
      });
    }
    const confirmed = await service.plan(TX, [FIELD_ID], target(), {
      hostKind: 'task',
      source: 'create',
      confirmEmpty: true,
    });
    expect(confirmed.ok).toBe(true);
  });

  it('«при создании»: только отмеченный тип и только пустое поле', async () => {
    const row = definition({
      bindings: [{ targetKind: 'process_type', targetId: TYPE_ID, numberOnCreate: true }],
    });
    const { service } = setup([row]);
    const inFolder = target({ folders: [{ id: FOLDER_KIND, kindId: FOLDER_KIND }] });
    const plan = await service.planOnCreate(TX, inFolder, {
      source: 'create',
      values: {},
    });
    expect(plan.ok).toBe(true);
    const filled = await service.planOnCreate(TX, inFolder, {
      source: 'type_change',
      values: { [FIELD_ID]: 'Изм. 1' },
    });
    expect(filled.ok).toBe(true);
    if (filled.ok) await expect(filled.issue(TX, 'task-1')).resolves.toEqual({});
  });
});
