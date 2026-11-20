import { describe, expect, it } from 'vitest';

import {
  isNumberInsertionType,
  NUMBER_INSERTION_FIELD_TYPES,
  numberInsertionText,
  unsupportedNumberInsertions,
} from './number-insertion.js';
import type { NumberTemplateSegment } from '../workflows/number-series.schemas.js';

/**
 * Печатные вставки номера (AUD-010, #877): один закрытый список для сервера,
 * интерфейса и демо-моков. У ссылок, денег, даты, флагов и составных типов
 * печатного вида нет — правило с такой вставкой не сохраняется.
 */
const def = (number: number, type: string, name = `Поле ${number}`) => ({ number, name, type });

describe('isNumberInsertionType: закрытый список печатных типов', () => {
  it('текст, число, длительность и список печатаются', () => {
    for (const type of ['text', 'long_text', 'number', 'duration', 'enum']) {
      expect(isNumberInsertionType(type), type).toBe(true);
    }
  });

  it('остальные типы не печатаются', () => {
    for (const type of [
      'money',
      'date',
      'datetime',
      'bool',
      'multienum',
      'user',
      'users',
      'department',
      'project',
      'counterparty',
      'task',
      'letter',
      'node',
      'link',
      'counter',
    ]) {
      expect(isNumberInsertionType(type), type).toBe(false);
    }
  });

  it('список — единственный источник (порядок фиксирован)', () => {
    expect([...NUMBER_INSERTION_FIELD_TYPES]).toEqual([
      'text',
      'long_text',
      'number',
      'duration',
      'enum',
    ]);
  });
});

describe('unsupportedNumberInsertions: какие вставки правила сервер отвергнет', () => {
  const field = (fieldNumber: number): NumberTemplateSegment => ({
    kind: 'field',
    fieldNumber,
    source: 'self',
  });

  it('правило из печатных типов сохранимо', () => {
    const template: NumberTemplateSegment[] = [
      { kind: 'counter' },
      { kind: 'literal', text: '/' },
      field(1),
      field(3),
    ];
    const definitions = [def(1, 'text'), def(3, 'enum')];
    expect(unsupportedNumberInsertions({ template }, definitions)).toEqual([]);
  });

  it('ссылка, деньги и дата — проблемы с номером, именем и типом', () => {
    const template: NumberTemplateSegment[] = [{ kind: 'counter' }, field(4), field(5), field(6)];
    const definitions = [
      def(4, 'link', 'Ссылка'),
      def(5, 'money', 'Сумма'),
      def(6, 'date', 'Дата'),
    ];
    expect(unsupportedNumberInsertions({ template }, definitions)).toEqual([
      { fieldNumber: 4, name: 'Ссылка', type: 'link' },
      { fieldNumber: 5, name: 'Сумма', type: 'money' },
      { fieldNumber: 6, name: 'Дата', type: 'date' },
    ]);
  });

  it('удалённый атрибут не проходит молча (missing)', () => {
    const template: NumberTemplateSegment[] = [field(99)];
    expect(unsupportedNumberInsertions({ template }, [def(1, 'text')])).toEqual([
      { fieldNumber: 99, name: '—', type: 'missing' },
    ]);
  });
});

describe('numberInsertionText: печатное значение одной грамматикой', () => {
  const codes = (id: string) => (id === 'item-1' ? 'КЖ' : undefined);

  it('текст — как есть, число и длительность — строкой', () => {
    expect(numberInsertionText('text', 'КЖ-01')).toBe('КЖ-01');
    expect(numberInsertionText('long_text', 'Строка')).toBe('Строка');
    expect(numberInsertionText('number', 12)).toBe('12');
    expect(numberInsertionText('duration', 3)).toBe('3');
  });

  it('список печатает код варианта; мёртвый вариант — пусто, а не UUID', () => {
    expect(numberInsertionText('enum', 'item-1', codes)).toBe('КЖ');
    expect(numberInsertionText('enum', 'dead-item', codes)).toBe('');
    expect(numberInsertionText('enum', 'item-1')).toBe('');
  });

  it('неподдержанные типы и несовместимые значения — пусто', () => {
    expect(numberInsertionText('date', '2026-11-19')).toBe('');
    expect(numberInsertionText('link', 'https://nodus.by')).toBe('');
    expect(numberInsertionText('money', 100)).toBe('');
    expect(numberInsertionText('text', 42)).toBe('');
    expect(numberInsertionText('number', Number.NaN)).toBe('');
    expect(numberInsertionText('number', null)).toBe('');
  });
});
