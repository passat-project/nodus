import type { InjectionToken } from '@nestjs/common';
import type { FormulaHostKind, FormulaNode, CustomFieldType } from '@nodus/contracts';
import type {
  FormulaDependency,
  FormulaEvaluation,
  FormulaRegistryMeta,
  FormulaResolver,
  FormulaTypeResult,
  FormulaValidationResult,
} from '@nodus/formula-engine';

/**
 * Порт движка формул (#632, Р3/Р11): фасад над `@nodus/formula-engine` —
 * одна реализация вычисления для API, моков и редактора (parity по
 * построению). Модули зовут движок только через порт, чтобы замена
 * реализации (например, кэш метаданных) не правила вызовы.
 */
export const FORMULA_ENGINE: InjectionToken = 'FORMULA_ENGINE';

export interface FormulaValidateOptions {
  hostKind: FormulaHostKind;
  meta: FormulaRegistryMeta;
  targetFieldType?: CustomFieldType;
  /** Формула типа/вида: запрещены related и цепочка папок (Р6). */
  typeDefault?: boolean;
}

export interface FormulaEngine {
  evaluate(ast: FormulaNode, resolver: FormulaResolver): FormulaEvaluation;
  validate(ast: FormulaNode, opts: FormulaValidateOptions): FormulaValidationResult;
  inferType(ast: FormulaNode, meta: FormulaRegistryMeta): FormulaTypeResult;
  extractDeps(ast: FormulaNode): FormulaDependency[];
}
