import type { CustomFieldType, FormulaHostKind } from '@nodus/contracts';

import { FORMULA_LIMITS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaStateMap } from '../ports/formula-cells.port.js';
import type { FormulaEngine } from '../ports/formula-engine.port.js';
import type { FormulaContextCache, FormulaContextService } from './formula-context.service.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';
import type { FormulaValuesService } from './formula-values.service.js';

/** Формулы типа/вида на чтении (#632, Р6): считаются для записей без своей
 *  формулы (значение больше не подавляет — ячейка с формулой руками не
 *  пишется, решение владельца по #660); значения в БД не материализуются. */
export async function applyTypeFormulas(args: {
  hostKind: FormulaHostKind;
  hostIds: readonly string[];
  /** hostId → место (typeId/kindId): без формулы места хост не читается. */
  places?: ReadonlyMap<string, string | null>;
  snapshot: FormulaRegistrySnapshot;
  ownByHost: ReadonlyMap<string, readonly string[]>;
  result: FormulaStateMap;
  tx?: TransactionClient;
  cache: FormulaContextCache;
  context: FormulaContextService;
  engine: FormulaEngine;
  values: FormulaValuesService;
}): Promise<void> {
  const {
    hostKind,
    hostIds,
    places,
    snapshot,
    ownByHost,
    result,
    tx,
    cache,
    context,
    engine,
    values,
  } = args;
  // Нет ни одной формулы типа/вида на портале — не читаем хосты вовсе:
  // список не платит N+1 за фичу, которой ещё не пользуются.
  if (snapshot.bindingFormulas.size === 0) return;
  for (const hostId of hostIds) {
    // Место известно из строки листинга: если у него нет формул, запись
    // хоста не читается (иначе одна формула на портале включает N+1 всем).
    if (places) {
      const place = places.get(hostId);
      if (!place) continue;
      if ((snapshot.bindingFormulas.get(place) ?? []).length === 0) continue;
    }
    const host = await context.record(hostKind, hostId, undefined, tx, cache);
    if (!host?.placeId) continue;
    const slots = snapshot.bindingFormulas.get(host.placeId) ?? [];
    if (slots.length === 0) continue;
    const own = new Set(ownByHost.get(hostId) ?? []);
    // Своя формула ячейки сильнее формулы типа (Р1); значения-подавления нет —
    // формульная ячейка руками не пишется (решение владельца по #660).
    const pending = slots.filter((slot) => !own.has(slot.definitionId));
    if (pending.length === 0) continue;
    const state = result.get(hostId) ?? { values: {}, formulas: {} };
    const evaluate = pending;
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
      if (materialized !== null) {
        state.values[slot.definitionId] = materialized;
      } else if (evaluation.value !== null) {
        // ЛОЖЬ в bool-поле — пустое значение, а не ошибка (как в compute).
        if (definition.type === 'bool' && evaluation.value === false) {
          continue;
        }
        // Непустой результат, не влезающий в тип поля (устаревший вариант
        // справочника/валюта): ошибка видна в ячейке, а не тихая пустота (Р13).
        state.formulas[slot.definitionId] = {
          origin: 'type',
          error: {
            code: 'type_mismatch',
            message: `formula result does not fit ${definition.type}`,
          },
        };
      }
    }
    result.set(hostId, state);
  }
}
