import { ui, type FormulaOperator } from '@nodus/contracts';

/** Лексер строки формулы (#632): числа, строки в кавычках, идентификаторы
 *  (функции/ИСТИНА/ЛОЖЬ), операторы, скобки и маркеры плашек. */

export class SyntaxProblem extends Error {}

type LexToken =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'ident'; value: string }
  | { kind: 'chip'; index: number }
  | { kind: 'op'; value: FormulaOperator }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'semi' }
  | { kind: 'eof' };

const CHIP_START = '\uE000';
const CHIP_END = '\uE001';

/** Типографские операторы из подсказок/копипаста → язык формул. */
const UNICODE_OPERATORS: Record<string, FormulaOperator> = {
  '−': 'sub',
  '×': 'mul',
  '÷': 'div',
  '≠': 'ne',
  '≤': 'le',
  '≥': 'ge',
};

function lex(source: string): LexToken[] {
  const tokens: LexToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const unicodeOp = UNICODE_OPERATORS[char];
    if (unicodeOp) {
      tokens.push({ kind: 'op', value: unicodeOp });
      index += 1;
      continue;
    }
    if (char === CHIP_START) {
      const end = source.indexOf(CHIP_END, index);
      if (end < 0) throw new SyntaxProblem(ui.formulas.editor.syntaxError);
      tokens.push({ kind: 'chip', index: Number(source.slice(index + 1, end)) });
      index = end + 1;
      continue;
    }
    if (char === '"') {
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index]!;
        if (current === '"') {
          if (source[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new SyntaxProblem(ui.formulas.editor.syntaxHint);
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[index + 1] ?? ''))) {
      let raw = '';
      while (index < source.length && /[0-9.,eE+-]/.test(source[index]!)) {
        const current = source[index]!;
        // Знак входит в число только сразу после экспоненты.
        if ((current === '+' || current === '-') && !/[eE]/.test(raw.at(-1) ?? '')) break;
        raw += current;
        index += 1;
      }
      const normalized = raw.replace(',', '.');
      const value = Number(normalized);
      if (!Number.isFinite(value)) throw new SyntaxProblem(ui.formulas.editor.syntaxError);
      tokens.push({ kind: 'number', value });
      continue;
    }
    if (/[A-Za-zА-Яа-яЁё_]/.test(char)) {
      let word = '';
      while (index < source.length && /[A-Za-zА-Яа-яЁё_0-9]/.test(source[index]!)) {
        word += source[index]!;
        index += 1;
      }
      const upper = word.toUpperCase();
      if (upper === 'ИСТИНА' || upper === 'TRUE') {
        tokens.push({ kind: 'boolean', value: true });
        continue;
      }
      if (upper === 'ЛОЖЬ' || upper === 'FALSE') {
        tokens.push({ kind: 'boolean', value: false });
        continue;
      }
      tokens.push({ kind: 'ident', value: word });
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      index += 1;
      continue;
    }
    if (char === ';' || char === ',') {
      tokens.push({ kind: 'semi' });
      index += 1;
      continue;
    }
    const two = source.slice(index, index + 2);
    if (two === '<>') {
      tokens.push({ kind: 'op', value: 'ne' });
      index += 2;
      continue;
    }
    if (two === '<=') {
      tokens.push({ kind: 'op', value: 'le' });
      index += 2;
      continue;
    }
    if (two === '>=') {
      tokens.push({ kind: 'op', value: 'ge' });
      index += 2;
      continue;
    }
    if (two === '!=') {
      tokens.push({ kind: 'op', value: 'ne' });
      index += 2;
      continue;
    }
    const single: Record<string, FormulaOperator> = {
      '+': 'add',
      '-': 'sub',
      '*': 'mul',
      '/': 'div',
      '&': 'concat',
      '=': 'eq',
      '<': 'lt',
      '>': 'gt',
    };
    const op = single[char];
    if (op) {
      tokens.push({ kind: 'op', value: op });
      index += 1;
      continue;
    }
    throw new SyntaxProblem(ui.formulas.editor.syntaxError);
  }
  tokens.push({ kind: 'eof' });
  return tokens;
}

export { lex, CHIP_START, CHIP_END };
export type { LexToken };
