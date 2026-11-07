import type { FormulaCellError, FormulaNode } from '@nodus/contracts';
import { FORMULA_LIMITS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaCellRef, FormulaRecalcOutcome } from '../ports/formula-cells.port.js';
import type { FormulaEngine } from '../ports/formula-engine.port.js';
import type { FormulaCellsRepository } from './formula-cells.repository.js';
import { formulaPlaceRejection } from './formula-cells.policy.js';
import { cellErrorOf } from './formula-cells.support.js';
import { computeFormula } from './formula-compute.js';
import type { FormulaContextService } from './formula-context.service.js';
import type { FormulaMetaService } from './formula-meta.service.js';
import { sameFormulaValue, type FormulaValuesService } from './formula-values.service.js';

/** Пересчёт одной ячейки (#632, Р4/Р8): вынесен из сервиса, чтобы файл
 *  сервиса оставался в лимите I5. Возвращает значение и ошибку — пишет
 *  значение штатный writer владельца хоста (I3). */
export interface FormulaRecalcDeps {
  repo: FormulaCellsRepository;
  meta: FormulaMetaService;
  context: FormulaContextService;
  values: FormulaValuesService;
  engine: FormulaEngine;
}

const silent = (): FormulaRecalcOutcome => ({
  value: null,
  error: null,
  changed: false,
  errorChanged: false,
  silent: true,
});

export async function recalcCell(
  deps: FormulaRecalcDeps,
  tx: TransactionClient,
  ref: FormulaCellRef,
  depth: number,
): Promise<FormulaRecalcOutcome> {
  const { repo, meta, context, values, engine } = deps;
  const cell = await repo.find(ref.hostKind, ref.hostId, ref.fieldId, tx);
  // Ячейку сняли/удалили, пока событие шло — пересчитывать нечего.
  if (!cell) return silent();
  const previousError = cellErrorOf(cell.error);

  if (depth > FORMULA_LIMITS.cascadeDepth) {
    const error: FormulaCellError = {
      code: 'cycle',
      message: 'formula recalculation cycle detected',
    };
    await repo.updateState(tx, cell.id, { error, depth });
    return {
      value: null,
      error,
      changed: true,
      errorChanged: previousError?.code !== error.code,
      silent: true,
    };
  }

  const snapshot = await meta.snapshot(tx);
  const ast = cell.ast as FormulaNode;
  const ctx = await context.build(
    { hostKind: ref.hostKind, hostId: ref.hostId, asts: [ast], snapshot },
    tx,
  );
  if (!ctx) {
    await repo.deleteByHost(tx, ref.hostKind, ref.hostId);
    return silent();
  }
  const definition = snapshot.byId.get(ref.fieldId);
  if (!definition) {
    await repo.remove(tx, ref.hostKind, ref.hostId, ref.fieldId);
    return silent();
  }
  // Привязку сняли/атрибут стал глобальным — значение больше некуда писать:
  // честная ошибка ячейки вместо тихого warn от writer'а.
  const rejection = formulaPlaceRejection(definition, ctx.host.placeId);
  if (rejection) {
    const previous = ctx.host.values[ref.fieldId] ?? null;
    const changed = !sameFormulaValue(previous, null);
    const errorChanged = (previousError?.code ?? null) !== rejection.code;
    await repo.updateState(tx, cell.id, { error: rejection, depth });
    return { value: null, error: rejection, changed, errorChanged, silent: false };
  }
  const outcome = await computeFormula({
    ast,
    context: ctx,
    snapshot,
    fieldId: ref.fieldId,
    engine,
    values,
  });
  const previous = ctx.host.values[ref.fieldId] ?? null;
  const changed = !sameFormulaValue(previous, outcome.value);
  const errorChanged = (previousError?.code ?? null) !== (outcome.error?.code ?? null);
  await repo.replaceDeps(tx, cell.id, ctx.depKeys);
  await repo.updateState(tx, cell.id, { error: outcome.error, depth });
  return { ...outcome, changed, errorChanged, silent: false };
}
