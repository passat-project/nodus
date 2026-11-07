// @vitest-environment jsdom
import { ui } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  AGGREGATE_CHIP_CLASS,
  CHIP_CLASS,
  createChipElement,
  insertChipAtCaret,
  insertTextAtCaret,
  readTokens,
  removeWordBeforeCaret,
  replaceChipElement,
  wordBeforeCaret,
} from './formula-dom.js';
import type {
  FormulaAggregateChip,
  FormulaChip,
  FormulaFieldChip,
  FormulaSystemChip,
} from './formula-text.js';

/** Механика строки формулы (#632, §4c): contenteditable с плашками-атомами.
 *  Плашки — span[data-chip-id], карта id → чип живёт в редакторе; чтение
 *  DOM даёт токены для парсера. Тестируем напрямую на div в jsdom. */

function fieldChip(
  name = 'Площадь',
  source: FormulaFieldChip['source'] = { kind: 'self' },
): FormulaFieldChip {
  return { type: 'field', key: `f-${name}`, number: 12, name, source };
}

function aggregateChip(): FormulaAggregateChip {
  return {
    type: 'aggregate',
    key: 'agg-1',
    aggregate: {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'sum',
    },
  };
}

function line(): HTMLDivElement {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  return root;
}

/** Каретка в конец текстового узла (набранное слово остаётся перед ней). */
function caretAfter(node: Text, offset = node.length): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('createChipElement (#632, §4c)', () => {
  it('плашка атрибута: тон info, contentEditable=false, зарегистрирована в карте, title = подписи', () => {
    const chips = new Map<string, FormulaChip>();
    const element = createChipElement(fieldChip('Шифр', { kind: 'project' }), chips, vi.fn());

    expect(element.tagName).toBe('SPAN');
    expect(element.contentEditable).toBe('false');
    expect(element.dataset.chipId).toBe('f-Шифр');
    expect(element.className).toBe(CHIP_CLASS);
    // Источник в подписи плашки: «Проект · Шифр».
    expect(element.textContent).toBe(`${ui.formulas.chipPrefix.project} · Шифр`);
    expect(element.title).toBe(`${ui.formulas.chipPrefix.project} · Шифр`);
    expect(chips.get('f-Шифр')).toMatchObject({ type: 'field', number: 12 });
  });

  it('плашка агрегата: тон primary, подпись «СУММА · Подзадачи», dblclick открывает правку', () => {
    const chips = new Map<string, FormulaChip>();
    const onEdit = vi.fn();
    const chip = aggregateChip();
    const element = createChipElement(chip, chips, onEdit);

    expect(element.className).toBe(AGGREGATE_CHIP_CLASS);
    expect(element.textContent).toBe(
      `${ui.formulas.aggregates.sum} · ${ui.formulas.sources.subtasks}`,
    );
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith(chip);
  });

  it('плашка системного поля: подпись из i18n, свой источник — без префикса', () => {
    const chips = new Map<string, FormulaChip>();
    const chip: FormulaSystemChip = {
      type: 'system',
      key: 'sys-1',
      entity: 'task',
      fieldKey: 'title',
      source: { kind: 'self' },
    };
    const element = createChipElement(chip, chips, vi.fn());

    expect(element.textContent).toBe(ui.formulas.systemFields.task.title);
  });
});

describe('insertChipAtCaret / insertTextAtCaret (#632, §4c)', () => {
  it('без каретки плашка вставляется в конец и отделяется пробелом', () => {
    const root = line();
    root.textContent = '1 +';
    const chips = new Map<string, FormulaChip>();

    insertChipAtCaret(root, fieldChip(), chips, vi.fn());

    const chipElement = root.querySelector<HTMLElement>('[data-chip-id="f-Площадь"]');
    expect(chipElement).toBeTruthy();
    // После плашки — пробел: курсор встаёт за него, следующий ввод не липнет.
    expect(chipElement?.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(chipElement?.nextSibling?.textContent).toBe(' ');
    expect(chips.has('f-Площадь')).toBe(true);
  });

  it('с кареткой в середине текста вставка разрывает текст в месте курсора', () => {
    const root = line();
    const text = document.createTextNode('1 + 2');
    root.appendChild(text);
    caretAfter(text, 4); // между '1 + ' и '2'

    insertTextAtCaret(root, '5 ');
    insertChipAtCaret(root, fieldChip(), new Map(), vi.fn());

    expect(
      readTokens(root, new Map([['f-Площадь', fieldChip()]])).map((token) =>
        token.type === 'text' ? token.text : `${token.type}:${(token as FormulaFieldChip).number}`,
      ),
    ).toEqual(['1 + 5 ', 'field:12', ' 2']);
  });

  it('текст без каретки дописывается в конец строки', () => {
    const root = line();
    root.textContent = '1';
    insertTextAtCaret(root, ' + 2');
    expect(root.textContent).toBe('1 + 2');
  });
});

describe('readTokens (#632, §4c)', () => {
  it('соседние текстовые узлы склеиваются, BR даёт пробел, вложенные элементы обходятся', () => {
    const root = line();
    const chip = fieldChip();
    const chips = new Map<string, FormulaChip>([[chip.key, chip]]);
    // DOM после реальной вставки плашки: '1 +' | chip | br | <span>2</span>
    root.append(document.createTextNode('1 +'));
    root.appendChild(createChipElement(chip, new Map(chips), vi.fn()));
    root.append(document.createElement('br'));
    const nested = document.createElement('span');
    nested.textContent = '2';
    root.appendChild(nested);

    const tokens = readTokens(root, chips);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({ type: 'text', text: '1 +' });
    expect(tokens[1]).toMatchObject({ type: 'field', number: 12 });
    expect(tokens[2]).toEqual({ type: 'text', text: ' 2' }); // br → пробел, '2' из span
  });

  it('приватные маркеры плашек вырезаются из текста, неизвестный chip-id пропускается', () => {
    const root = line();
    root.append(document.createTextNode('a\uE000\uE001b'));
    const ghost = document.createElement('span');
    ghost.dataset.chipId = 'ghost';
    ghost.textContent = 'невидимка';
    root.appendChild(ghost);

    const tokens = readTokens(root, new Map());
    expect(tokens).toEqual([{ type: 'text', text: 'ab' }]);
  });
});

describe('replaceChipElement (#632, §4c)', () => {
  it('правка агрегата заменяет плашку на месте, ключ и позиция сохраняются', () => {
    const root = line();
    const chips = new Map<string, FormulaChip>();
    const original = aggregateChip();
    root.appendChild(createChipElement(original, chips, vi.fn()));
    root.append(document.createTextNode(' + 1'));

    const edited: FormulaAggregateChip = {
      type: 'aggregate',
      key: 'agg-1',
      aggregate: { ...original.aggregate, fn: 'count' },
    };
    const replaced = replaceChipElement(root, 'agg-1', edited, chips, vi.fn());

    expect(replaced).toBe(true);
    const element = root.querySelector<HTMLElement>('[data-chip-id="agg-1"]');
    expect(element?.textContent).toBe(
      `${ui.formulas.aggregates.count} · ${ui.formulas.sources.subtasks}`,
    );
    // Плашка осталась первой — строка не разрастается второй копией.
    expect(root.childNodes[0]).toBe(element);
    expect(chips.get('agg-1')).toMatchObject({ type: 'aggregate' });
  });

  it('плашки с таким ключом нет — false, DOM не тронут', () => {
    const root = line();
    const before = root.innerHTML;
    expect(replaceChipElement(root, 'missing', aggregateChip(), new Map(), vi.fn())).toBe(false);
    expect(root.innerHTML).toBe(before);
  });
});

describe('wordBeforeCaret / removeWordBeforeCaret (#632, автодополнение)', () => {
  it('слово перед курсором — латиница/кириллица/цифры; каретки нет — пусто', () => {
    const root = line();
    expect(wordBeforeCaret(root)).toBe('');

    const text = document.createTextNode('площадь + ном12_');
    root.appendChild(text);
    caretAfter(text);
    expect(wordBeforeCaret(root)).toBe('ном12_');

    caretAfter(text, 7); // после 'площадь'
    expect(wordBeforeCaret(root)).toBe('площадь');
  });

  it('удаление слова вырезает ровно его длину перед курсором', () => {
    const root = line();
    const text = document.createTextNode('площадь + ном');
    root.appendChild(text);
    caretAfter(text);

    removeWordBeforeCaret(root, 'ном'.length);

    expect(root.textContent).toBe('площадь + ');
  });
});
