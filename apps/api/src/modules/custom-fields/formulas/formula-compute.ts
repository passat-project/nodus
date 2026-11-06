import type { CustomFieldType } from '@nodus/contracts';
import { FORMULA_LIMITS } from '@nodus/contracts';
import type { FormulaNode } from '@nodus/contracts';

import type { FormulaComputation } from '../ports/formula-cells.port.js';
import type { FormulaEngine } from '../ports/formula-engine.port.js';
import type { FormulaContext } from './formula-context.service.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';
import type { FormulaValuesService } from './formula-values.service.js';

/** Вычисление формулы ячейки с материализацией значения (#632, Р13):
 *  ошибка ячейки важнее значения — протухшее число не показывается живым. */
/** Вычисление + материализация: ошибка ячейки важнее значения (Р13). */
export async function computeFormula(args: {
  ast: FormulaNode;
  context: FormulaContext;
  snapshot: FormulaRegistrySnapshot;
  fieldId: string;
  engine: FormulaEngine;
  values: FormulaValuesService;
}): Promise<FormulaComputation> {
  const { ast, context, snapshot, fieldId, engine, values } = args;
  const evaluation = engine.evaluate(ast, context.resolver);
  if (context.overflowed) {
    return {
      value: null,
      error: {
        code: 'selection_limit',
        message: `aggregate selection exceeds ${FORMULA_LIMITS.selection} records`,
      },
    };
  }
  if (evaluation.error) return { value: null, error: evaluation.error };
  const definition = snapshot.byId.get(fieldId);
  if (!definition) return { value: null, error: null };
  const materialized = await values.materialize(
    {
      type: definition.type as CustomFieldType,
      settings: (definition.settings ?? {}) as never,
    },
    evaluation.value,
  );
  if (materialized === null && evaluation.value !== null) {
    return {
      value: null,
      error: {
        code: 'type_mismatch',
        message: `formula result does not fit ${definition.type}`,
      },
    };
  }
  return { value: materialized, error: null };
}
