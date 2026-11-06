import {
  FORMULA_FUNCTIONS,
  ui,
  type FormulaFunctionId,
  type FormulaNode,
  type FormulaOperator,
} from '@nodus/contracts';

import { CHIP_START, CHIP_END, lex, SyntaxProblem, type LexToken } from './formula-lexer.js';
import type { FormulaChip, FormulaToken } from './formula-text.js';

/** Парсер строки формулы (#632): ограниченная грамматика плана — сравнения,
 *  арифметика, конкатенация, скобки, функции каталога, неявная склейка
 *  соседних операндов. Плашки приходят маркерами и становятся узлами AST. */

const FUNCTION_BY_NAME = new Map<string, FormulaFunctionId>();
for (const spec of FORMULA_FUNCTIONS) {
  FUNCTION_BY_NAME.set(spec.id.toLowerCase(), spec.id);
  FUNCTION_BY_NAME.set(ui.formulas.functions[spec.id].toUpperCase(), spec.id);
}

const COMPARISONS = new Set<FormulaOperator>(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: LexToken[],
    private readonly chips: readonly FormulaChip[],
  ) {}

  private peek(): LexToken {
    return this.tokens[this.position]!;
  }

  private next(): LexToken {
    return this.tokens[this.position++]!;
  }

  parse(): FormulaNode {
    const node = this.expression();
    if (this.peek().kind !== 'eof') throw new SyntaxProblem(ui.formulas.editor.syntaxError);
    return node;
  }

  private expression(): FormulaNode {
    return this.comparison();
  }

  private comparison(): FormulaNode {
    let left = this.additive();
    while (
      this.peek().kind === 'op' &&
      COMPARISONS.has((this.peek() as { value: FormulaOperator }).value)
    ) {
      const operator = (this.next() as { value: FormulaOperator }).value;
      const right = this.additive();
      left = { kind: 'op', op: operator, args: [left, right] };
    }
    return left;
  }

  private additive(): FormulaNode {
    let left = this.multiplicative();
    while (
      this.peek().kind === 'op' &&
      ['add', 'sub'].includes((this.peek() as { value: FormulaOperator }).value)
    ) {
      const operator = (this.next() as { value: FormulaOperator }).value;
      const right = this.multiplicative();
      left = { kind: 'op', op: operator, args: [left, right] };
    }
    return left;
  }

  private multiplicative(): FormulaNode {
    let left = this.concat();
    while (
      this.peek().kind === 'op' &&
      ['mul', 'div'].includes((this.peek() as { value: FormulaOperator }).value)
    ) {
      const operator = (this.next() as { value: FormulaOperator }).value;
      const right = this.concat();
      left = { kind: 'op', op: operator, args: [left, right] };
    }
    return left;
  }

  private concat(): FormulaNode {
    const args: FormulaNode[] = [this.unary()];
    for (;;) {
      const token = this.peek();
      if (token.kind === 'op' && token.value === 'concat') {
        this.next();
        args.push(this.unary());
        continue;
      }
      // Неявная склейка соседних операндов: {Марка}{Номер}, "a" {b}.
      if (
        token.kind === 'number' ||
        token.kind === 'string' ||
        token.kind === 'boolean' ||
        token.kind === 'ident' ||
        token.kind === 'chip' ||
        token.kind === 'lparen'
      ) {
        args.push(this.unary());
        continue;
      }
      break;
    }
    if (args.length === 1) return args[0]!;
    return { kind: 'op', op: 'concat', args };
  }

  private unary(): FormulaNode {
    const token = this.peek();
    if (token.kind === 'op' && (token.value === 'add' || token.value === 'sub')) {
      this.next();
      const value = this.unary();
      return token.value === 'add'
        ? value
        : { kind: 'op', op: 'sub', args: [{ kind: 'literal', value: 0 }, value] };
    }
    return this.primary();
  }

  private primary(): FormulaNode {
    const token = this.next();
    switch (token.kind) {
      case 'number':
      case 'string':
      case 'boolean':
        return { kind: 'literal', value: token.value };
      case 'chip': {
        const chip = this.chips[token.index];
        if (!chip) throw new SyntaxProblem(ui.formulas.editor.syntaxError);
        if (chip.type === 'aggregate') return chip.aggregate;
        if (chip.type === 'system') {
          return {
            kind: 'system',
            source: chip.source,
            entity: chip.entity,
            key: chip.fieldKey,
            ...(chip.name ? { name: chip.name } : {}),
          };
        }
        return {
          kind: 'field',
          source: chip.source,
          number: chip.number,
          ...(chip.name ? { name: chip.name } : {}),
        };
      }
      case 'lparen': {
        const node = this.expression();
        if (this.next().kind !== 'rparen') throw new SyntaxProblem(ui.formulas.editor.syntaxHint);
        return node;
      }
      case 'ident': {
        const fn = FUNCTION_BY_NAME.get(token.value.toUpperCase());
        if (!fn) throw new SyntaxProblem(`${ui.formulas.editor.syntaxError}: ${token.value}`);
        if (this.next().kind !== 'lparen') throw new SyntaxProblem(ui.formulas.editor.syntaxHint);
        const args: FormulaNode[] = [];
        if (this.peek().kind !== 'rparen') {
          for (;;) {
            args.push(this.expression());
            if (this.peek().kind === 'semi') {
              this.next();
              continue;
            }
            break;
          }
        }
        if (this.next().kind !== 'rparen') throw new SyntaxProblem(ui.formulas.editor.syntaxHint);
        return { kind: 'call', fn, args };
      }
      default:
        throw new SyntaxProblem(ui.formulas.editor.syntaxError);
    }
  }
}

/** Токены редактора → AST. Пустая формула — `ast: null` без ошибки. */
export function tokensToAst(tokens: readonly FormulaToken[]): {
  ast: FormulaNode | null;
  error: string | null;
} {
  const chips: FormulaChip[] = [];
  let source = '';
  for (const token of tokens) {
    if (token.type === 'text') {
      source += token.text;
      continue;
    }
    source += `${CHIP_START}${chips.length}${CHIP_END}`;
    chips.push(token);
  }
  if (source.trim().length === 0) return { ast: null, error: null };
  try {
    const ast = new Parser(lex(source), chips).parse();
    return { ast, error: null };
  } catch (error) {
    return {
      ast: null,
      error: error instanceof SyntaxProblem ? error.message : ui.formulas.editor.syntaxError,
    };
  }
}
