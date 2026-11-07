import type {
  CustomFieldType,
  CustomFieldValue,
  FormulaHostKind,
  FormulaNode,
} from '@nodus/contracts';
import { FORMULA_LIMITS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import type { FormulaComputation } from '../ports/formula-cells.port.js';
import type { FormulaEngine } from '../ports/formula-engine.port.js';
import type { FormulaContextService } from './formula-context.service.js';
import type { FormulaMetaService } from './formula-meta.service.js';
import type { FormulaValuesService } from './formula-values.service.js';

/** Зависимости вычисления без записи (префилл окна/создания, Р12). */
export interface FormulaEvaluateDeps {
  meta: FormulaMetaService;
  context: FormulaContextService;
  values: FormulaValuesService;
  engine: FormulaEngine;
}

/** Параметры вычисления: `actor` — видимость хоста (Р7), `fieldId`/`fieldType`
 *  — материализация результата под тип слота. */
export interface FormulaEvaluateOptions {
  actor?: ProjectActor;
  fieldId?: string;
  fieldType?: CustomFieldType;
  tx?: TransactionClient;
}

/**
 * Вычисление без записи (префилл окна/создания, Р12): контекст хоста,
 * материализация под тип слота. Ошибка расчёта — пустое значение (Р13).
 */
export async function evaluateFormula(
  deps: FormulaEvaluateDeps,
  hostKind: FormulaHostKind,
  hostId: string,
  ast: FormulaNode,
  opts: FormulaEvaluateOptions = {},
): Promise<FormulaComputation> {
  const snapshot = await deps.meta.snapshot(opts.tx);
  const context = await deps.context.build(
    {
      hostKind,
      hostId,
      asts: [ast],
      snapshot,
      ...(opts.actor ? { actor: opts.actor } : {}),
    },
    opts.tx,
  );
  if (!context) throw DomainException.notFound('Formula host not found');
  if (context.overflowed) {
    return {
      value: null,
      error: {
        code: 'selection_limit',
        message: `aggregate selection exceeds ${FORMULA_LIMITS.selection} records`,
      },
    };
  }
  const evaluation = deps.engine.evaluate(ast, context.resolver);
  if (evaluation.error) return { value: null, error: evaluation.error };
  const definition = opts.fieldId ? snapshot.byId.get(opts.fieldId) : undefined;
  const type = (definition?.type as CustomFieldType | undefined) ?? opts.fieldType;
  if (!type) {
    return { value: (evaluation.value ?? null) as CustomFieldValue | null, error: null };
  }
  const materialized = await deps.values.materialize(
    { type, settings: (definition?.settings ?? {}) as never },
    evaluation.value,
  );
  if (materialized === null && evaluation.value !== null) {
    return {
      value: null,
      error: { code: 'type_mismatch', message: `formula result does not fit ${type}` },
    };
  }
  return { value: materialized, error: null };
}
