import type { CustomFieldValue, FormulaHostKind, FormulaNode } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaPreviewEntry, FormulaPreviewOverride } from '../ports/formula-cells.port.js';
import type { FormulaEngine } from '../ports/formula-engine.port.js';
import type { FormulaRecordData } from '../ports/record-values.port.js';
import { computeFormula } from './formula-compute.js';
import { createFormulaCache, FormulaContextService } from './formula-context.service.js';
import { FormulaCellsRepository } from './formula-cells.repository.js';
import { FormulaMetaService } from './formula-meta.service.js';
import { FormulaValuesService, sameFormulaValue } from './formula-values.service.js';

/** Зависимости dry-run переноса (move-preview, Р10). */
export interface FormulaPreviewDeps {
  repo: FormulaCellsRepository;
  meta: FormulaMetaService;
  context: FormulaContextService;
  values: FormulaValuesService;
  engine: FormulaEngine;
}

/**
 * Dry-run переноса (Р10, move-preview): значения своих ячеек и действующих
 * формул типа/вида «до» и «после» подмены места. Ничего не пишет; ошибка
 * расчёта даёт `to = null` (перенос не блокируется, Р13).
 */
export async function previewCells(
  deps: FormulaPreviewDeps,
  hostKind: FormulaHostKind,
  hostIds: readonly string[],
  override: FormulaPreviewOverride,
  tx?: TransactionClient,
): Promise<FormulaPreviewEntry[]> {
  if (hostIds.length === 0) return [];
  const snapshot = await deps.meta.snapshot(tx);
  const cache = createFormulaCache();
  const cells = await deps.repo.listByHosts(hostKind, hostIds, tx);
  const ownByHost = new Map<string, typeof cells>();
  for (const cell of cells) {
    const list = ownByHost.get(cell.hostId) ?? [];
    list.push(cell);
    ownByHost.set(cell.hostId, list);
  }
  const entries: FormulaPreviewEntry[] = [];
  for (const hostId of hostIds) {
    const own = ownByHost.get(hostId) ?? [];
    // Место хоста нужно до сборки контекста: формулы типа живут на привязке.
    const base = await deps.context.record(hostKind, hostId, undefined, tx, cache);
    if (!base) continue;
    const placeFormulas = (
      base.placeId ? (snapshot.bindingFormulas.get(base.placeId) ?? []) : []
    ).filter(
      (entry) =>
        !own.some((cell) => cell.fieldId === entry.definitionId) &&
        base.values[entry.definitionId] === undefined,
    );
    const asts: FormulaNode[] = [
      ...own.map((cell) => cell.ast as FormulaNode),
      ...placeFormulas.map((entry) => entry.ast),
    ];
    if (asts.length === 0) continue;
    const before = await deps.context.build({ hostKind, hostId, asts, snapshot }, tx, cache);
    const after = await deps.context.build(
      { hostKind, hostId, asts, snapshot, override },
      tx,
      cache,
    );
    if (!before || !after) continue;
    const hostLabel = hostLabelOf(base);
    for (const cell of own) {
      const fieldName = snapshot.byId.get(cell.fieldId)?.name ?? 'Атрибут';
      const from = (before.host.values[cell.fieldId] ?? null) as CustomFieldValue | null;
      const outcome = await computeFormula({
        ast: cell.ast as FormulaNode,
        context: after,
        snapshot,
        fieldId: cell.fieldId,
        engine: deps.engine,
        values: deps.values,
      });
      const to = outcome.error ? null : ((outcome.value ?? null) as CustomFieldValue | null);
      if (sameFormulaValue(from, to)) continue;
      entries.push({ hostKind, hostId, fieldId: cell.fieldId, hostLabel, fieldName, from, to });
    }
    for (const entry of placeFormulas) {
      const fieldName = snapshot.byId.get(entry.definitionId)?.name ?? 'Атрибут';
      const oldValue = await computeFormula({
        ast: entry.ast,
        context: before,
        snapshot,
        fieldId: entry.definitionId,
        engine: deps.engine,
        values: deps.values,
      });
      const newValue = await computeFormula({
        ast: entry.ast,
        context: after,
        snapshot,
        fieldId: entry.definitionId,
        engine: deps.engine,
        values: deps.values,
      });
      const from = oldValue.error ? null : ((oldValue.value ?? null) as CustomFieldValue | null);
      const to = newValue.error ? null : ((newValue.value ?? null) as CustomFieldValue | null);
      if (sameFormulaValue(from, to)) continue;
      entries.push({
        hostKind,
        hostId,
        fieldId: entry.definitionId,
        hostLabel,
        fieldName,
        from,
        to,
      });
    }
  }
  return entries;
}

/** Подпись записи для диалога переноса: номер/название из системных полей. */
function hostLabelOf(record: FormulaRecordData): string {
  const title = record.system['title'];
  const name = record.system['name'];
  const number = record.system['number'];
  const base = typeof title === 'string' && title !== '' ? title : null;
  if (base) return typeof number === 'number' ? `#${number} ${base}` : base;
  if (typeof name === 'string' && name !== '') return name;
  return typeof number === 'number' ? `#${number}` : record.id.slice(0, 8);
}
