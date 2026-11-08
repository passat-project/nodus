import { describe, expect, it } from 'vitest';
import type { NumberSeriesRule } from '@nodus/contracts';

import {
  containerLabel,
  containerOf,
  containerPath,
  containerShort,
  containersShort,
  counterPreviewOf,
  counterSequence,
  createTriggerReason,
  DEFAULT_COUNTER_RULE,
  fill,
  minskMoment,
  ruleShort,
  unreachableReason,
  withTemplate,
} from './counter-rule.js';
import { onCreateOf, triggerProblems, unreachableBindings } from './counter-draft.js';

const names = {
  nodeKind: (id: string) => (id === 'kind-1' ? 'Комплект' : undefined),
  field: (number: number) => (number === 7 ? 'Инв. №' : undefined),
};

const rule = (overrides: Partial<NumberSeriesRule> = {}): NumberSeriesRule => ({
  ...DEFAULT_COUNTER_RULE,
  ...overrides,
});

describe('counter-rule (#630): чистые функции окна', () => {
  it('момент по Минску, подстановка и пример номера', () => {
    expect(minskMoment(new Date('2026-12-31T23:30:00.000Z'))).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(fill('{a}-{b}', { a: '1' })).toBe('1-{b}');
    expect(
      counterPreviewOf(
        rule({
          template: [
            { kind: 'counter' },
            { kind: 'literal', text: '-' },
            { kind: 'year', digits: 2 },
          ],
        }),
        5,
        new Date('2026-11-08T10:00:00.000Z'),
      ),
    ).toBe('5-26');
  });

  it('последовательность: три номера и граница нового периода', () => {
    expect(counterSequence(rule(), 3, new Date('2026-11-08T10:00:00.000Z'))).toHaveLength(3);
    for (const period of ['year', 'quarter', 'month', 'day'] as const) {
      const items = counterSequence(rule({ period }), 1, new Date('2026-11-08T10:00:00.000Z'));
      expect(items).toHaveLength(4);
      expect(items[3]!.boundary).toBeTruthy();
    }
    const quarter = counterSequence(
      rule({ period: 'quarter' }),
      1,
      new Date('2026-12-08T10:00:00.000Z'),
    );
    expect(quarter).toHaveLength(4);
  });

  it('withTemplate: год возвращает «заново каждый год», убрали — снимает', () => {
    const yearly = rule({
      period: 'year',
      template: [{ kind: 'counter' }, { kind: 'year', digits: 2 }],
    });
    expect(withTemplate(yearly, [{ kind: 'counter' }]).period).toBe('none');
    expect(withTemplate(rule(), [{ kind: 'counter' }, { kind: 'year', digits: 2 }]).period).toBe(
      'year',
    );
  });

  it('условия: ключи, подписи, путь и одна фраза', () => {
    expect(containerOf('folder:kind-1')).toEqual({ kind: 'folder', nodeKindId: 'kind-1' });
    expect(containerOf('field:7')).toEqual({ kind: 'field', fieldNumber: 7 });
    expect(containerOf('project')).toEqual({ kind: 'project' });
    const folder = { kind: 'folder' as const, nodeKindId: 'kind-1' };
    const field = { kind: 'field' as const, fieldNumber: 7 };
    expect(containerLabel(folder, names)).toContain('Комплект');
    expect(containerShort(folder, names)).toContain('Комплект');
    expect(containerPath(folder, names)).toContain('Комплект');
    expect(containerLabel(field, names)).toContain('Инв. №');
    expect(containerShort({ kind: 'folder', nodeKindId: 'нет' }, names)).toContain('—');
    expect(containersShort([], names)).toBeTruthy();
    expect(containersShort([folder, field], names)).toContain('Комплект');
    expect(ruleShort(rule({ containers: [folder], period: 'year' }), names)).toBeTruthy();
  });

  it('почему тип не может получать номер и «при создании»', () => {
    const folder = [{ kind: 'folder' as const, nodeKindId: 'kind-1' }];
    expect(unreachableReason(folder, 'letter')).toBeTruthy();
    expect(unreachableReason([{ kind: 'project' }], 'project')).toBeTruthy();
    expect(unreachableReason(folder, 'node')).toBeNull();
    expect(unreachableReason(folder, 'task')).toBeNull();
    expect(
      createTriggerReason(
        rule({ containers: [{ kind: 'project' }], template: [{ kind: 'counter' }] }),
        'letter',
      ),
    ).toBeTruthy();
    expect(
      createTriggerReason(
        rule({
          containers: [],
          template: [{ kind: 'field', fieldNumber: 7, source: 'self' }, { kind: 'counter' }],
        }),
        'letter',
      ),
    ).toBeTruthy();
    expect(createTriggerReason(rule(), 'task')).toBeNull();
  });
});

describe('counter-draft (#630): совместимость привязок', () => {
  const draft = (overrides: Record<string, unknown> = {}) =>
    ({
      bindings: { processTypeIds: ['type'], projectTypeIds: [], nodeKindIds: [] },
      numbering: rule({ containers: [{ kind: 'folder', nodeKindId: 'kind-1' }] }),
      numberingOnCreate: ['type'],
      ...overrides,
    }) as never;
  const hostOf = (id: string) =>
    id === 'letter' ? ('letter' as const) : id === 'node' ? ('node' as const) : ('task' as const);

  it('недостижимые привязки и onCreate только у отмеченных', () => {
    expect(unreachableBindings(draft(), hostOf)).toEqual([]);
    expect(
      unreachableBindings(
        draft({ bindings: { processTypeIds: ['letter'], projectTypeIds: [], nodeKindIds: [] } }),
        hostOf,
      ),
    ).toEqual(['letter']);
    expect(onCreateOf(draft({ numberingOnCreate: ['type', 'чужой'] }))).toEqual(['type']);
  });

  it('проблемы триггера: папка без onCreate, письмо с полем', () => {
    expect(
      triggerProblems(
        draft({ bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: ['node'] } }),
        hostOf,
      ),
    ).toEqual(['node']);
    expect(
      triggerProblems(
        draft({
          bindings: { processTypeIds: ['letter'], projectTypeIds: [], nodeKindIds: [] },
          numberingOnCreate: ['letter'],
          numbering: rule({
            containers: [{ kind: 'project' }],
            template: [{ kind: 'counter' }],
          }),
        }),
        hostOf,
      ),
    ).toEqual(['letter']);
    expect(triggerProblems(draft(), hostOf)).toEqual([]);
  });
});
