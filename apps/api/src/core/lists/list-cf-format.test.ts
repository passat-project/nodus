import { describe, expect, it } from 'vitest';

import { formatCfValue } from './list-cf-format.js';

const UUID1 = '00000000-0000-4000-8000-0000000000a1';
const UUID2 = '00000000-0000-4000-8000-0000000000a2';
const LABELS = { true: 'да', false: 'нет' };
const REFS = new Map([
  [UUID1, 'Сметный отдел'],
  [UUID2, null],
]);

describe('формат значений атрибутов CSV (#435)', () => {
  it('текст/число/деньги/флаг — как есть', () => {
    expect(formatCfValue({ id: 'f', type: 'text', settings: {} }, 'Просто', REFS, LABELS)).toBe(
      'Просто',
    );
    expect(formatCfValue({ id: 'f', type: 'number', settings: {} }, 12.5, REFS, LABELS)).toBe(12.5);
    expect(
      formatCfValue(
        { id: 'f', type: 'money', settings: {} },
        { amount: 99.5, currencyId: UUID1 },
        REFS,
        LABELS,
      ),
    ).toBe(99.5);
    expect(formatCfValue({ id: 'f', type: 'bool', settings: {} }, true, REFS, LABELS)).toBe('да');
    expect(formatCfValue({ id: 'f', type: 'date', settings: {} }, '2026-11-01', REFS, LABELS)).toBe(
      '2026-11-01',
    );
  });

  it('ссылки — по именам; недоступная цель — null', () => {
    expect(formatCfValue({ id: 'f', type: 'department', settings: {} }, UUID1, REFS, LABELS)).toBe(
      'Сметный отдел',
    );
    expect(formatCfValue({ id: 'f', type: 'user', settings: {} }, UUID2, REFS, LABELS)).toBeNull();
  });

  it('multienum/users — имена через запятую; скаляр читается как один элемент (Р3)', () => {
    expect(
      formatCfValue({ id: 'f', type: 'multienum', settings: {} }, [UUID1, UUID2], REFS, LABELS),
    ).toBe('Сметный отдел');
    expect(formatCfValue({ id: 'f', type: 'users', settings: {} }, UUID1, REFS, LABELS)).toBe(
      'Сметный отдел',
    );
    expect(formatCfValue({ id: 'f', type: 'users', settings: {} }, null, REFS, LABELS)).toBeNull();
  });

  it('enum/counterparty/task/letter/node — тоже имя ссылки; не-строка — null', () => {
    expect(formatCfValue({ id: 'f', type: 'enum', settings: {} }, UUID1, REFS, LABELS)).toBe(
      'Сметный отдел',
    );
    expect(formatCfValue({ id: 'f', type: 'node', settings: {} }, UUID2, REFS, LABELS)).toBeNull();
    expect(formatCfValue({ id: 'f', type: 'user', settings: {} }, 42, REFS, LABELS)).toBeNull();
  });

  it('bool — подпись ячейки; деньги без объекта — null, строка читаема как есть', () => {
    expect(formatCfValue({ id: 'f', type: 'bool', settings: {} }, false, REFS, LABELS)).toBe('нет');
    expect(formatCfValue({ id: 'f', type: 'money', settings: {} }, 7, REFS, LABELS)).toBeNull();
    expect(formatCfValue({ id: 'f', type: 'money', settings: {} }, {}, REFS, LABELS)).toBeNull();
    expect(formatCfValue({ id: 'f', type: 'number', settings: {} }, 'семь', REFS, LABELS)).toBe(
      'семь',
    );
    expect(formatCfValue({ id: 'f', type: 'duration', settings: {} }, '120', REFS, LABELS)).toBe(
      '120',
    );
  });

  it('массивы без типа-списка читаются читаемо: имена/id через запятую', () => {
    expect(
      formatCfValue({ id: 'f', type: 'date', settings: {} }, [UUID1, 'свободное'], REFS, LABELS),
    ).toBe('Сметный отдел, свободное');
    // id без имени в справочнике остаётся собой (якорь), а не пустотой.
    expect(formatCfValue({ id: 'f', type: 'date', settings: {} }, [UUID2], REFS, LABELS)).toBe(
      UUID2,
    );
    expect(formatCfValue({ id: 'f', type: 'date', settings: {} }, true, REFS, LABELS)).toBe('да');
    expect(
      formatCfValue({ id: 'f', type: 'date', settings: {} }, { o: 1 }, REFS, LABELS),
    ).toBeNull();
  });
});
