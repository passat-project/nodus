import {
  aggregateChipLabel,
  chipLabel,
  systemChipLabel,
  type FormulaChip,
  type FormulaToken,
} from './formula-text.js';

/** Механика строки формулы (#632, §4c): contenteditable с плашками-атомами.
 *  Плашки — нередактируемые span с `data-chip-id`; карта id → чип живёт в
 *  редакторе. Чтение DOM даёт токены, которые парсер превращает в AST. */

/** Плашка атрибута в строке формулы: тон `info` (атрибут — источник данных),
 *  радиус контрола, кегль на ступень ниже строки (12/16 в моно 13/24) —
 *  читается вложенной в код, но не спорит с операторами по весу. */
export const CHIP_CLASS =
  'mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-md border border-info/30 bg-info/10 px-1.5 py-px align-baseline text-xs font-medium text-info';
/** Плашка агрегата: тон `primary` (выборка посчитана по записям), «Σ» в
 *  начале — форма отличается от плашки атрибута до чтения подписи. */
export const AGGREGATE_CHIP_CLASS =
  'mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-px align-baseline text-xs font-medium text-primary';

/** Прочитать строку в токены (соседние текстовые узлы склеиваются). */
export function readTokens(
  root: HTMLElement,
  chips: ReadonlyMap<string, FormulaChip>,
): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  const pushText = (text: string) => {
    const clean = text.replace(/[\uE000\uE001]/g, '');
    if (clean.length === 0) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === 'text') last.text += clean;
    else tokens.push({ type: 'text', text: clean });
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const chipId = element.dataset.chipId;
    if (chipId) {
      const chip = chips.get(chipId);
      if (chip) tokens.push(chip);
      return;
    }
    if (element.tagName === 'BR') {
      pushText(' ');
      return;
    }
    element.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return tokens;
}

export function caretRange(root: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range : null;
}

export function createChipElement(
  chip: FormulaChip,
  chips: Map<string, FormulaChip>,
  onAggregateEdit: (chip: Extract<FormulaChip, { type: 'aggregate' }>) => void,
): HTMLElement {
  const element = document.createElement('span');
  element.contentEditable = 'false';
  element.dataset.chipId = chip.key;
  element.className = chip.type === 'field' ? CHIP_CLASS : AGGREGATE_CHIP_CLASS;
  element.textContent =
    chip.type === 'field'
      ? chipLabel(chip)
      : chip.type === 'system'
        ? systemChipLabel(chip)
        : aggregateChipLabel(chip);
  element.title = element.textContent;
  chips.set(chip.key, chip);
  if (chip.type === 'aggregate') {
    element.addEventListener('dblclick', () => onAggregateEdit(chip));
  }
  return element;
}

/** Вставить узел в позицию курсора (нет каретки — в конец строки). */
export function insertNodeAtCaret(root: HTMLElement, node: Node): void {
  root.focus();
  const range = caretRange(root);
  const selection = window.getSelection();
  if (!range) {
    root.appendChild(node);
    const after = document.createRange();
    after.selectNodeContents(root);
    after.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(after);
    return;
  }
  range.deleteContents();
  range.insertNode(node);
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(after);
}

/** Вставить плашку и поставить курсор после неё (через пробел). */
export function insertChipAtCaret(
  root: HTMLElement,
  chip: FormulaChip,
  chips: Map<string, FormulaChip>,
  onAggregateEdit: (chip: Extract<FormulaChip, { type: 'aggregate' }>) => void,
): void {
  const element = createChipElement(chip, chips, onAggregateEdit);
  insertNodeAtCaret(root, element);
  const space = document.createTextNode(' ');
  element.after(space);
  const selection = window.getSelection();
  const after = document.createRange();
  after.setStart(space, 1);
  after.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(after);
}

export function insertTextAtCaret(root: HTMLElement, text: string): void {
  insertNodeAtCaret(root, document.createTextNode(text));
}

/** Слово перед курсором (латиница/кириллица/цифры) — для автодополнения. */
export function wordBeforeCaret(root: HTMLElement): string {
  const range = caretRange(root);
  if (!range) return '';
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const match = /([A-Za-zА-Яа-яЁё0-9_]{1,30})$/.exec(before.toString());
  return match?.[1] ?? '';
}

/** Удалить набранное слово перед курсором (замена на плашку). */
export function removeWordBeforeCaret(root: HTMLElement, length: number): void {
  const range = caretRange(root);
  if (!range) return;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const start = Math.max(0, range.startOffset - length);
  const cut = document.createRange();
  cut.setStart(node, start);
  cut.setEnd(node, range.startOffset);
  cut.deleteContents();
  const after = document.createRange();
  after.setStart(node, start);
  after.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(after);
}
