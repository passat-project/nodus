import {
  ui,
  type FormulaAggregate,
  type FormulaEntity,
  type FormulaFunctionId,
  type FormulaNode,
  type FormulaOperator,
  type FormulaSource,
} from '@nodus/contracts';

/**
 * Текстовая форма формулы для редактора плашек (#632, §4c): AST ↔
 * последовательность «плашка атрибута / плашка агрегата / текст». Строка
 * формулы вводится свободно (числа, операторы, кавычки), атрибуты — плашки;
 * агрегаты — тоже плашки со своим диалогом (селектор + функция + атрибут).
 * Парсер ограничен языком плана (не Excel-строка): литералы, операторы,
 * скобки, функции каталога, неявная склейка соседних операндов.
 */

export interface FormulaFieldChip {
  type: 'field';
  key: string;
  number: number;
  name?: string;
  source: FormulaSource;
}

export interface FormulaSystemChip {
  type: 'system';
  key: string;
  entity: FormulaEntity;
  fieldKey: string;
  name?: string;
  source: FormulaSource;
}

export interface FormulaAggregateChip {
  type: 'aggregate';
  key: string;
  aggregate: FormulaAggregate;
}

export type FormulaChip = FormulaFieldChip | FormulaSystemChip | FormulaAggregateChip;
export type FormulaToken = FormulaChip | { type: 'text'; text: string };

let chipSeq = 0;
export function nextChipKey(): string {
  chipSeq += 1;
  return `chip-${chipSeq}`;
}

const OPERATOR_SYMBOL: Record<FormulaOperator, string> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  concat: '&',
  eq: '=',
  ne: '<>',
  lt: '<',
  le: '<=',
  gt: '>',
  ge: '>=',
};

const PRECEDENCE: Record<FormulaOperator, number> = {
  eq: 1,
  ne: 1,
  lt: 1,
  le: 1,
  gt: 1,
  ge: 1,
  // Склейка ниже арифметики (как `&` в Excel): `{Цена}*{Кол} & " руб"`
  // читается как склейка результата умножения, а не умножение склейки.
  concat: 2,
  add: 3,
  sub: 3,
  mul: 4,
  div: 4,
};

function functionLabel(fn: FormulaFunctionId): string {
  return ui.formulas.functions[fn];
}

function printLiteral(value: number | string | boolean): string {
  if (typeof value === 'string') {
    // Приватные маркеры плашек не должны попасть в текст: иначе разбор
    // строки уходит в вечный цикл/подменяет кусок литерала плашкой.
    return `"${value.replace(/[]/g, '').replace(/"/g, '""')}"`;
  }
  if (typeof value === 'boolean') return value ? 'ИСТИНА' : 'ЛОЖЬ';
  // Отрицательный литерал в склейке (`1 -2`) репарсился как вычитание;
  // скобки сохраняют значение при round-trip.
  return value < 0 ? `(0${String(value)})` : String(value);
}

function printNode(node: FormulaNode, tokens: FormulaToken[], parentPrecedence: number): string {
  switch (node.kind) {
    case 'literal':
      return printLiteral(node.value);
    case 'system': {
      const chip: FormulaSystemChip = {
        type: 'system',
        key: nextChipKey(),
        entity: node.entity,
        fieldKey: node.key,
        source: node.source,
        ...(node.name ? { name: node.name } : {}),
      };
      tokens.push(chip);
      return `\uE000${tokens.length - 1}\uE001`;
    }
    case 'field': {
      const chip: FormulaFieldChip = {
        type: 'field',
        key: nextChipKey(),
        number: node.number,
        source: node.source,
        ...(node.name ? { name: node.name } : {}),
      };
      tokens.push(chip);
      return `\uE000${tokens.length - 1}\uE001`;
    }
    case 'aggregate': {
      const chip: FormulaAggregateChip = {
        type: 'aggregate',
        key: nextChipKey(),
        aggregate: node,
      };
      tokens.push(chip);
      return `\uE000${tokens.length - 1}\uE001`;
    }
    case 'call':
      return `${functionLabel(node.fn)}(${node.args
        .map((arg) => printNode(arg, tokens, 0))
        .join('; ')})`;
    case 'op': {
      const precedence = PRECEDENCE[node.op];
      if (node.op === 'concat') {
        const parts = node.args.map((arg) => printNode(arg, tokens, precedence + 1));
        const text = parts.join(' ');
        return precedence < parentPrecedence ? `(${text})` : text;
      }
      const left = node.args[0];
      const right = node.args[1];
      if (!left || !right) return '';
      const leftText = printNode(left, tokens, precedence);
      const rightText = printNode(
        right,
        tokens,
        node.op === 'sub' || node.op === 'div' ? precedence + 1 : precedence,
      );
      const text = `${leftText} ${OPERATOR_SYMBOL[node.op]} ${rightText}`;
      return precedence < parentPrecedence ? `(${text})` : text;
    }
  }
}

/** AST → токены редактора (плашки + текст). */
export function astToTokens(ast: FormulaNode): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  const text = printNode(ast, tokens, 0);
  // Текст и плашки восстанавливаются по маркерам \uE000N\uE001.
  const result: FormulaToken[] = [];
  let buffer = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '\uE000') {
      if (buffer) {
        result.push({ type: 'text', text: buffer });
        buffer = '';
      }
      const end = text.indexOf('\uE001', index);
      const chipIndex = Number(text.slice(index + 1, end));
      const chip = tokens[chipIndex];
      if (chip) result.push(chip);
      index = end;
      continue;
    }
    buffer += char;
  }
  if (buffer) result.push({ type: 'text', text: buffer });
  return result;
}

/** Подпись плашки атрибута: «Проект · Шифр» (источник + имя-снимок). */
export function systemChipLabel(chip: FormulaSystemChip): string {
  const labels = ui.formulas.systemFields as Record<string, Record<string, string>>;
  const label = labels[chip.entity]?.[chip.fieldKey] ?? chip.name ?? chip.fieldKey;
  return chip.source.kind === 'self' ? label : `${chipLabelSource(chip.source)} · ${label}`;
}

function chipLabelSource(source: FormulaSource): string {
  switch (source.kind) {
    case 'parent_task':
      return ui.formulas.chipPrefix.parent;
    case 'folder_nearest':
      return ui.formulas.chipPrefix.folder;
    case 'project':
      return ui.formulas.chipPrefix.project;
    case 'company':
      return ui.formulas.chipPrefix.company;
    case 'ref_field':
      return ui.formulas.chipPrefix.ref;
    default:
      return '';
  }
}

export function chipLabel(chip: FormulaFieldChip): string {
  const name = chip.name ?? `#${chip.number}`;
  switch (chip.source.kind) {
    case 'self':
      return name;
    case 'parent_task':
      return `${ui.formulas.chipPrefix.parent} · ${name}`;
    case 'folder_nearest':
      return `${ui.formulas.chipPrefix.folder} · ${name}`;
    case 'project':
      return `${ui.formulas.chipPrefix.project} · ${name}`;
    case 'company':
      return `${ui.formulas.chipPrefix.company} · ${name}`;
    case 'ref_field':
      return `${ui.formulas.chipPrefix.ref} · ${name}`;
    default:
      return name;
  }
}

/** Подпись плашки агрегата: «СУММА · Подзадачи · Сумма». */
export function aggregateChipLabel(chip: FormulaAggregateChip): string {
  const aggregate = chip.aggregate;
  const from =
    aggregate.from.kind === 'folder_chain'
      ? ui.formulas.sources.folderChain
      : aggregate.from.selector.kind === 'subtasks'
        ? ui.formulas.sources.subtasks
        : aggregate.from.selector.kind === 'node_tasks'
          ? ui.formulas.sources.nodeTasks
          : ui.formulas.sources.relations;
  const fn = ui.formulas.aggregates[aggregate.fn];
  return `${fn} · ${from}`;
}
