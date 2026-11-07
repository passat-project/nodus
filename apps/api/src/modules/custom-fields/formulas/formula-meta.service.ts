import { Injectable } from '@nestjs/common';
import type { FormulaNode } from '@nodus/contracts';
import type { FormulaFieldMeta, FormulaRegistryMeta } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import { DefinitionsRepository } from '../definitions/definitions.repository.js';

/** Снимок реестра для вычисления формул (#632): number → мета атрибута,
 *  id → определение, формулы мест (Р6). Один запрос на операцию. */
export interface FormulaRegistrySnapshot {
  meta: FormulaRegistryMeta;
  byNumber: ReadonlyMap<number, FieldDefinitionRow>;
  byId: ReadonlyMap<string, FieldDefinitionRow>;
  /** Формула привязки по targetId (тип/вид) — у каждого места своя (Р6). */
  bindingFormulas: ReadonlyMap<string, readonly { definitionId: string; ast: FormulaNode }[]>;
}

/**
 * Метаданные реестра атрибутов для движка формул (#632, Р2): адресация по
 * внутреннему номеру, тип и справочник для статического тайпинга. Реестр
 * портала ≤ 1000 (Р12) — один запрос на операцию без кэша: устаревшая
 * мета опаснее лишнего чтения (формула типизируется на момент сохранения).
 */
@Injectable()
export class FormulaMetaService {
  /** Один снимок на транзакцию (#632, аудит 3): массовый пересчёт сотен
   *  ячеек больше не читает весь реестр на каждую. Ключ — объект транзакции;
   *  формулы не меняют реестр внутри той же транзакции, поэтому снимок не
   *  устаревает. */
  private readonly byTransaction = new WeakMap<object, Promise<FormulaRegistrySnapshot>>();

  constructor(private readonly repo: DefinitionsRepository) {}

  async snapshot(tx?: TransactionClient): Promise<FormulaRegistrySnapshot> {
    if (!tx) return this.load(tx);
    const cached = this.byTransaction.get(tx);
    if (cached) return cached;
    const pending = this.load(tx);
    this.byTransaction.set(tx, pending);
    return pending;
  }

  private async load(tx?: TransactionClient): Promise<FormulaRegistrySnapshot> {
    const rows = await this.repo.list(tx);
    const byNumber = new Map<number, FieldDefinitionRow>();
    const byId = new Map<string, FieldDefinitionRow>();
    const bindingFormulas = new Map<string, { definitionId: string; ast: FormulaNode }[]>();
    for (const row of rows) {
      byNumber.set(row.number, row);
      byId.set(row.id, row);
      for (const binding of row.bindings) {
        if (binding.defaultFormula === null || binding.defaultFormula === undefined) continue;
        const list = bindingFormulas.get(binding.targetId) ?? [];
        list.push({ definitionId: row.id, ast: binding.defaultFormula as FormulaNode });
        bindingFormulas.set(binding.targetId, list);
      }
    }
    return { meta: metaOf(rows), byNumber, byId, bindingFormulas };
  }
}

/** Мета для тайпинга: номер, тип и справочник (УНИКАЛЬНЫЕ, Р2). */
export function metaOf(rows: readonly FieldDefinitionRow[]): FormulaRegistryMeta {
  const byNumber = new Map<number, FormulaFieldMeta>();
  for (const row of rows) {
    byNumber.set(row.number, {
      number: row.number,
      type: row.type as FormulaFieldMeta['type'],
      dictionaryId: dictionaryIdOf(row),
    });
  }
  return { byNumber };
}

function dictionaryIdOf(row: FieldDefinitionRow): string | null {
  const settings = (row.settings ?? {}) as { dictionaryId?: unknown };
  return typeof settings.dictionaryId === 'string' ? settings.dictionaryId : null;
}
