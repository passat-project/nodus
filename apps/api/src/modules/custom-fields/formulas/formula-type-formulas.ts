import type { CustomFieldType, FormulaHostKind } from '@nodus/contracts';

import { FORMULA_LIMITS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaStateMap } from '../ports/formula-cells.port.js';
import type { FormulaEngine } from '../ports/formula-engine.port.js';
import type { FormulaContextCache, FormulaContextService } from './formula-context.service.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';
import type { FormulaValuesService } from './formula-values.service.js';

/** Формулы типа/вида на чтении (#632, Р6): считаются для записей без своего
 *  значения и своей формулы; значения в БД не материализуются. */
export async function applyTypeFormulas(args: {
  hostKind: FormulaHostKind;
  hostIds: readonly string[];
  snapshot: FormulaRegistrySnapshot;
  ownByHost: ReadonlyMap<string, readonly string[]>;
  result: FormulaStateMap;
  tx?: TransactionClient;
  cache: FormulaContextCache;
  context: FormulaContextService;
  engine: FormulaEngine;
  values: FormulaValuesService;
}): Promise<void> {
  const { hostKind, hostIds, snapshot, ownByHost, result, tx, cache, context, engine, values } =
    args;
  for (const hostId of hostIds) {
    const host = await context.record(hostKind, hostId, undefined, tx, cache);
    if (!host?.placeId) continue;
    const slots = snapshot.bindingFormulas.get(host.placeId) ?? [];
    if (slots.length === 0) continue;
    const own = new Set(ownByHost.get(hostId) ?? []);
    const pending = slots.filter((slot) => !own.has(slot.definitionId));
    if (pending.length === 0) continue;
    const state = result.get(hostId) ?? { values: {}, formulas: {} };
    const evaluate = pending.filter((slot) => host.values[slot.definitionId] === undefined);
    for (const slot of pending) {
      if (host.values[slot.definitionId] !== undefined) {
        state.formulas[slot.definitionId] = { origin: 'value' };
      }
    }
    if (evaluate.length === 0) {
      result.set(hostId, state);
      continue;
    }
    const ctx = await context.build(
      { hostKind, hostId, asts: evaluate.map((slot) => slot.ast), snapshot },
      tx,
      cache,
    );
    if (!ctx) continue;
    for (const slot of evaluate) {
      const definition = snapshot.byId.get(slot.definitionId);
      const evaluation = engine.evaluate(slot.ast, ctx.resolver);
      if (ctx.overflowed) {
        state.formulas[slot.definitionId] = {
          origin: 'type',
          error: {
            code: 'selection_limit',
            message: `aggregate selection exceeds ${FORMULA_LIMITS.selection} records`,
          },
        };
        continue;
      }
      if (evaluation.error) {
        state.formulas[slot.definitionId] = { origin: 'type', error: evaluation.error };
        continue;
      }
      state.formulas[slot.definitionId] = { origin: 'type' };
      if (!definition) continue;
      const materialized = await values.materialize(
        {
          type: definition.type as CustomFieldType,
          settings: (definition.settings ?? {}) as never,
        },
        evaluation.value,
      );
      if (materialized !== null) state.values[slot.definitionId] = materialized;
    }
    result.set(hostId, state);
  }
}
