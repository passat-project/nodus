import { Injectable } from '@nestjs/common';
import type { FormulaNode } from '@nodus/contracts';
import {
  evaluate,
  extractDeps,
  inferType,
  validateFormula,
  type FormulaRegistryMeta,
  type FormulaResolver,
} from '@nodus/formula-engine';

import type { FormulaEngine, FormulaValidateOptions } from './formula-engine.port.js';

/**
 * Реализация порта движка (#632, Р3): тонкий фасад над чистым пакетом —
 * состояния нет, вычисление детерминировано (В4: без СЕГОДНЯ/сейчас).
 */
@Injectable()
export class FormulaEngineProvider implements FormulaEngine {
  evaluate(ast: FormulaNode, resolver: FormulaResolver) {
    return evaluate(ast, resolver);
  }

  validate(ast: FormulaNode, opts: FormulaValidateOptions) {
    return validateFormula(ast, opts);
  }

  inferType(ast: FormulaNode, meta: FormulaRegistryMeta) {
    return inferType(ast, meta);
  }

  extractDeps(ast: FormulaNode) {
    return extractDeps(ast);
  }
}
