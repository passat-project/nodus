import { Injectable } from '@nestjs/common';
import type { FormulaHostKind } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaCellRef } from '../ports/formula-cells.port.js';
import type { FormulaDepKey } from './formula-dep-keys.js';

/** Строка ячейки-формулы в объёме сервиса. */
export interface FormulaCellRow {
  id: string;
  hostKind: string;
  hostId: string;
  fieldId: string;
  ast: unknown;
  error: unknown;
  computedAt: Date;
  recalcDepth: number;
}

/**
 * Доступ к `formula_cells`/`formula_deps` (#632, Р1/Р4): таблицы модуля
 * custom-fields (I3), чужие модули ходят только через порт `FORMULA_CELLS`.
 */
@Injectable()
export class FormulaCellsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TransactionClient) {
    return tx ?? this.prisma;
  }

  async listByHosts(
    hostKind: FormulaHostKind,
    hostIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<FormulaCellRow[]> {
    if (hostIds.length === 0) return [];
    return this.db(tx).formulaCell.findMany({
      where: { hostKind, hostId: { in: [...hostIds] } },
      select: cellSelect,
    });
  }

  async listByHost(
    hostKind: FormulaHostKind,
    hostId: string,
    tx?: TransactionClient,
  ): Promise<FormulaCellRow[]> {
    return this.db(tx).formulaCell.findMany({
      where: { hostKind, hostId },
      select: cellSelect,
      orderBy: { fieldId: 'asc' },
    });
  }

  async find(
    hostKind: FormulaHostKind,
    hostId: string,
    fieldId: string,
    tx?: TransactionClient,
  ): Promise<FormulaCellRow | null> {
    return this.db(tx).formulaCell.findUnique({
      where: { hostKind_hostId_fieldId: { hostKind, hostId, fieldId } },
      select: cellSelect,
    });
  }

  /** Создание/замена формулы ячейки; deps переписываются вызывающим. */
  async upsert(
    tx: TransactionClient,
    data: {
      hostKind: FormulaHostKind;
      hostId: string;
      fieldId: string;
      ast: Prisma.InputJsonValue;
      createdById: string | null;
    },
  ): Promise<string> {
    const row = await tx.formulaCell.upsert({
      where: {
        hostKind_hostId_fieldId: {
          hostKind: data.hostKind,
          hostId: data.hostId,
          fieldId: data.fieldId,
        },
      },
      update: { ast: data.ast, error: Prisma.DbNull, recalcDepth: 0, computedAt: new Date() },
      create: {
        hostKind: data.hostKind,
        hostId: data.hostId,
        fieldId: data.fieldId,
        ast: data.ast,
        createdById: data.createdById,
      },
      select: { id: true },
    });
    return row.id;
  }

  async replaceDeps(
    tx: TransactionClient,
    cellId: string,
    deps: readonly FormulaDepKey[],
  ): Promise<void> {
    await tx.formulaDep.deleteMany({ where: { cellId } });
    if (deps.length === 0) return;
    await tx.formulaDep.createMany({
      data: deps.map((dep) => ({
        cellId,
        depKey: dep.key,
        attrNumber: dep.attrNumber,
      })),
      skipDuplicates: true,
    });
  }

  async updateState(
    tx: TransactionClient,
    cellId: string,
    state: { error: unknown; depth: number },
  ): Promise<void> {
    await tx.formulaCell.update({
      where: { id: cellId },
      data: {
        error:
          state.error === null || state.error === undefined
            ? Prisma.DbNull
            : (state.error as Prisma.InputJsonValue),
        recalcDepth: state.depth,
        computedAt: new Date(),
      },
    });
  }

  async remove(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
    fieldId: string,
  ): Promise<void> {
    await tx.formulaCell.deleteMany({ where: { hostKind, hostId, fieldId } });
  }

  async removeMany(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
    fieldIds: readonly string[],
  ): Promise<void> {
    if (fieldIds.length === 0) return;
    await tx.formulaCell.deleteMany({
      where: { hostKind, hostId, fieldId: { in: [...fieldIds] } },
    });
  }

  async deleteByHost(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
  ): Promise<void> {
    await tx.formulaCell.deleteMany({ where: { hostKind, hostId } });
  }

  /** Ячейки по ключам зависимостей (Р4): `dep_key IN (…)`. */
  async byDepKeys(keys: readonly string[], tx?: TransactionClient): Promise<FormulaCellRef[]> {
    if (keys.length === 0) return [];
    const rows = await this.db(tx).formulaDep.findMany({
      where: { depKey: { in: [...keys] } },
      select: { cell: { select: { id: true, hostKind: true, hostId: true, fieldId: true } } },
    });
    return dedupeCells(rows.map((row) => row.cell));
  }

  /** Ячейки, ссылающиеся на номер атрибута (Р13: удаление определения). */
  async byAttrNumber(number: number, tx?: TransactionClient): Promise<FormulaCellRef[]> {
    const rows = await this.db(tx).formulaDep.findMany({
      where: { attrNumber: number },
      select: { cell: { select: { id: true, hostKind: true, hostId: true, fieldId: true } } },
    });
    return dedupeCells(rows.map((row) => row.cell));
  }

  /** Ячейки по префиксу dep_key: удалённый источник (`v:task:<id>:`,
   *  `system:task:<id>`) — потребители находятся одним запросом. */
  async byDepPrefix(prefix: string, tx?: TransactionClient): Promise<FormulaCellRef[]> {
    // Диапазон вместо `LIKE 'prefix%'`: btree с не-C коллацией не обслуживает
    // LIKE, а `>= prefix AND < prefix+MAX` — обычный range scan (A3-05, без
    // миграции и text_pattern_ops). Ключи dep — ASCII (`v:task:<id>:<n>`).
    const rows = await this.db(tx).formulaDep.findMany({
      where: { depKey: { gte: prefix, lt: `${prefix}\uFFFF` } },
      select: { cell: { select: { id: true, hostKind: true, hostId: true, fieldId: true } } },
    });
    return dedupeCells(rows.map((row) => row.cell));
  }

  /** Свои ячейки атрибута (смена привязок типа/вида, Р3/Р13). */
  async byFieldId(fieldId: string, tx?: TransactionClient): Promise<FormulaCellRef[]> {
    const rows = await this.db(tx).formulaCell.findMany({
      where: { fieldId },
      select: { id: true, hostKind: true, hostId: true, fieldId: true },
    });
    return dedupeCells(rows);
  }

  /** Есть ли вообще ячейки, зависящие от номера (быстрая проверка события). */
  async countByAttrNumber(number: number, tx?: TransactionClient): Promise<number> {
    return this.db(tx).formulaDep.count({ where: { attrNumber: number } });
  }

  async findNumberById(definitionId: string, tx?: TransactionClient): Promise<number | null> {
    const row = await this.db(tx).fieldDefinition.findUnique({
      where: { id: definitionId },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  /** Свои формулы ячеек атрибута (#632, F1 — usage «В формулах»). */
  async countByFieldId(fieldId: string, tx?: TransactionClient): Promise<number> {
    return this.db(tx).formulaCell.count({ where: { fieldId } });
  }

  /** Формулы привязок типа/вида атрибута (F1). */
  async countTypeDefaults(fieldId: string, tx?: TransactionClient): Promise<number> {
    return this.db(tx).fieldBinding.count({
      where: { definitionId: fieldId, defaultFormula: { not: Prisma.DbNull } },
    });
  }
}

const cellSelect = {
  id: true,
  hostKind: true,
  hostId: true,
  fieldId: true,
  ast: true,
  error: true,
  computedAt: true,
  recalcDepth: true,
} as const;

function dedupeCells(
  rows: readonly { id: string; hostKind: string; hostId: string; fieldId: string }[],
): FormulaCellRef[] {
  const seen = new Set<string>();
  const refs: FormulaCellRef[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    refs.push({
      cellId: row.id,
      hostKind: row.hostKind as FormulaHostKind,
      hostId: row.hostId,
      fieldId: row.fieldId,
    });
  }
  return refs;
}
