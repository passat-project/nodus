import { Inject, Injectable } from '@nestjs/common';
import type {
  FormulaCellError,
  FormulaHostKind,
  FormulaNode,
  FormulaResponse,
} from '@nodus/contracts';
import { FORMULA_LIMITS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type {
  FormulaCellRef,
  FormulaCells,
  FormulaComputation,
  FormulaPreviewEntry,
  FormulaPreviewOverride,
  FormulaRecalcOutcome,
  FormulaSaveArgs,
  FormulaStateMap,
} from '../ports/formula-cells.port.js';
import { FORMULA_ENGINE, type FormulaEngine } from '../ports/formula-engine.port.js';
import { FormulaCellsRepository } from './formula-cells.repository.js';
import { asCellError, cellErrorOf, errorCodeOf, refOf } from './formula-cells.support.js';
import { computeFormula } from './formula-compute.js';
import { evaluateFormula, type FormulaEvaluateOptions } from './formula-evaluate.js';
import { previewCells } from './formula-preview.js';
import { applyTypeFormulas } from './formula-type-formulas.js';
import { createFormulaCache, FormulaContextService } from './formula-context.service.js';
import { FormulaMetaService, type FormulaRegistrySnapshot } from './formula-meta.service.js';
import { FormulaValuesService, sameFormulaValue } from './formula-values.service.js';

/**
 * Ячейки-формулы (#632, Р1/Р4/Р5): хранение, проверка, вычисление,
 * пересчёт. Значение результата НЕ пишется здесь — его материализует
 * штатный writer владельца хоста (I3, Р4); сервис отдаёт значение и ошибку.
 *
 * Ошибка ячейки не блокирует работу (Р13): сохраняется в formula_cells.error,
 * значение при ошибке пустое (протухшее число не показывается живым).
 */
@Injectable()
export class FormulaCellsService implements FormulaCells {
  constructor(
    private readonly repo: FormulaCellsRepository,
    private readonly meta: FormulaMetaService,
    private readonly context: FormulaContextService,
    private readonly values: FormulaValuesService,
    @Inject(FORMULA_ENGINE) private readonly engine: FormulaEngine,
  ) {}

  async stateFor(
    hostKind: FormulaHostKind,
    hostIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<FormulaStateMap> {
    const result: FormulaStateMap = new Map();
    if (hostIds.length === 0) return result;
    const cells = await this.repo.listByHosts(hostKind, hostIds, tx);
    const ownByHost = new Map<string, string[]>();
    for (const cell of cells) {
      const state = result.get(cell.hostId) ?? { values: {}, formulas: {} };
      state.formulas[cell.fieldId] = {
        origin: 'own',
        ...(cell.error ? { error: asCellError(cell.error) } : {}),
      };
      result.set(cell.hostId, state);
      const own = ownByHost.get(cell.hostId) ?? [];
      own.push(cell.fieldId);
      ownByHost.set(cell.hostId, own);
    }
    const snapshot = await this.meta.snapshot(tx);
    const cache = createFormulaCache();
    await applyTypeFormulas({
      hostKind,
      hostIds,
      snapshot,
      ownByHost,
      result,
      tx,
      cache,
      context: this.context,
      engine: this.engine,
      values: this.values,
    });
    return result;
  }

  async read(
    hostKind: FormulaHostKind,
    hostId: string,
    fieldId: string,
    tx?: TransactionClient,
  ): Promise<FormulaResponse> {
    const cell = await this.repo.find(hostKind, hostId, fieldId, tx);
    if (cell) return { ast: cell.ast as FormulaNode, origin: 'own' };
    const snapshot = await this.meta.snapshot(tx);
    const host = await this.context.build({ hostKind, hostId, asts: [], snapshot }, tx);
    if (!host) throw DomainException.notFound('Formula host not found');
    const formula = host.placeFormula(fieldId);
    if (!formula) return { ast: null, origin: null };
    const hasValue = host.host.values[fieldId] !== undefined;
    return { ast: formula, origin: hasValue ? 'value' : 'type' };
  }

  async save(tx: TransactionClient, args: FormulaSaveArgs): Promise<FormulaComputation> {
    const snapshot = await this.meta.snapshot(tx);
    const definition = snapshot.byId.get(args.fieldId);
    if (!definition) throw DomainException.notFound('Custom field not found');
    this.assertValid(args.ast, args.hostKind, snapshot, definition.type);

    const context = await this.context.build(
      { hostKind: args.hostKind, hostId: args.hostId, asts: [args.ast], snapshot },
      tx,
    );
    if (!context) throw DomainException.notFound('Formula host not found');
    const outcome = await computeFormula({
      ast: args.ast,
      context,
      snapshot,
      fieldId: definition.id,
      engine: this.engine,
      values: this.values,
    });
    const cellId = await this.repo.upsert(tx, {
      hostKind: args.hostKind,
      hostId: args.hostId,
      fieldId: args.fieldId,
      ast: args.ast as never,
      createdById: args.actorId,
    });
    await this.repo.replaceDeps(tx, cellId, context.depKeys);
    await this.repo.updateState(tx, cellId, { error: outcome.error, depth: 0 });
    return outcome;
  }

  async remove(
    tx: TransactionClient,
    args: { hostKind: FormulaHostKind; hostId: string; fieldId: string },
  ): Promise<void> {
    await this.repo.remove(tx, args.hostKind, args.hostId, args.fieldId);
  }

  async release(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
    fieldIds: readonly string[],
  ): Promise<void> {
    await this.repo.removeMany(tx, hostKind, hostId, fieldIds);
  }

  dependentCellsByValues(
    hostKind: FormulaHostKind,
    hostId: string,
    numbers: readonly number[],
    tx?: TransactionClient,
  ): Promise<FormulaCellRef[]> {
    const keys = numbers.map((number) => `v:${hostKind}:${hostId}:${number}`);
    return this.repo.byDepKeys(keys, tx);
  }

  dependentCellsByAttrNumber(number: number, tx?: TransactionClient): Promise<FormulaCellRef[]> {
    return this.repo.byAttrNumber(number, tx);
  }

  dependentCellsByDepKey(key: string, tx?: TransactionClient): Promise<FormulaCellRef[]> {
    return this.repo.byDepKeys([key], tx);
  }

  dependentCellsByDepPrefix(prefix: string, tx?: TransactionClient): Promise<FormulaCellRef[]> {
    return this.repo.byDepPrefix(prefix, tx);
  }

  dependentCellsByField(fieldId: string, tx?: TransactionClient): Promise<FormulaCellRef[]> {
    return this.repo.byFieldId(fieldId, tx);
  }

  async cellsForHost(
    hostKind: FormulaHostKind,
    hostId: string,
    tx?: TransactionClient,
  ): Promise<FormulaCellRef[]> {
    const rows = await this.repo.listByHost(hostKind, hostId, tx);
    return rows.map((row) => refOf(row));
  }

  numberByDefinitionId(definitionId: string, tx?: TransactionClient): Promise<number | null> {
    return this.repo.findNumberById(definitionId, tx);
  }

  async depthOf(
    hostKind: FormulaHostKind,
    hostId: string,
    fieldId: string,
    tx?: TransactionClient,
  ): Promise<number | null> {
    const cell = await this.repo.find(hostKind, hostId, fieldId, tx);
    return cell?.recalcDepth ?? null;
  }

  async recalc(
    tx: TransactionClient,
    ref: FormulaCellRef,
    depth: number,
  ): Promise<FormulaRecalcOutcome> {
    const cell = await this.repo.find(ref.hostKind, ref.hostId, ref.fieldId, tx);
    // Ячейку сняли/удалили, пока событие шло — пересчитывать нечего.
    if (!cell)
      return { value: null, error: null, changed: false, errorChanged: false, silent: true };
    const previousError = cellErrorOf(cell.error);

    if (depth > FORMULA_LIMITS.cascadeDepth) {
      const error: FormulaCellError = {
        code: 'cycle',
        message: 'formula recalculation cycle detected',
      };
      await this.repo.updateState(tx, cell.id, { error, depth });
      return {
        value: null,
        error,
        changed: true,
        errorChanged: previousError?.code !== error.code,
        silent: true,
      };
    }

    const snapshot = await this.meta.snapshot(tx);
    const ast = cell.ast as FormulaNode;
    const context = await this.context.build(
      { hostKind: ref.hostKind, hostId: ref.hostId, asts: [ast], snapshot },
      tx,
    );
    if (!context) {
      await this.repo.deleteByHost(tx, ref.hostKind, ref.hostId);
      return { value: null, error: null, changed: false, errorChanged: false, silent: true };
    }
    const definition = snapshot.byId.get(ref.fieldId);
    if (!definition) {
      await this.repo.remove(tx, ref.hostKind, ref.hostId, ref.fieldId);
      return { value: null, error: null, changed: false, errorChanged: false, silent: true };
    }
    const outcome = await computeFormula({
      ast,
      context,
      snapshot,
      fieldId: ref.fieldId,
      engine: this.engine,
      values: this.values,
    });
    const previous = context.host.values[ref.fieldId] ?? null;
    const changed = !sameFormulaValue(previous, outcome.value);
    const errorChanged = (previousError?.code ?? null) !== (outcome.error?.code ?? null);
    await this.repo.replaceDeps(tx, cell.id, context.depKeys);
    await this.repo.updateState(tx, cell.id, { error: outcome.error, depth });
    return { ...outcome, changed, errorChanged, silent: false };
  }

  /**
   * Вычисление без записи (префилл окна/создания, Р12): контекст хоста,
   * материализация под тип слота. Ошибка расчёта — пустое значение (Р13).
   */
  async evaluate(
    hostKind: FormulaHostKind,
    hostId: string,
    ast: FormulaNode,
    opts: FormulaEvaluateOptions = {},
  ): Promise<FormulaComputation> {
    return evaluateFormula(
      { meta: this.meta, context: this.context, values: this.values, engine: this.engine },
      hostKind,
      hostId,
      ast,
      opts,
    );
  }

  async cleanupHost(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
  ): Promise<void> {
    await this.repo.deleteByHost(tx, hostKind, hostId);
  }

  async preview(
    hostKind: FormulaHostKind,
    hostIds: readonly string[],
    override: FormulaPreviewOverride,
    tx?: TransactionClient,
  ): Promise<FormulaPreviewEntry[]> {
    return previewCells(
      {
        repo: this.repo,
        meta: this.meta,
        context: this.context,
        values: this.values,
        engine: this.engine,
      },
      hostKind,
      hostIds,
      override,
      tx,
    );
  }

  /** Статическая проверка перед записью: блокирующие проблемы — 422 (Р13). */
  private assertValid(
    ast: FormulaNode,
    hostKind: FormulaHostKind,
    snapshot: FormulaRegistrySnapshot,
    fieldType: string,
  ): void {
    const validation = this.engine.validate(ast, {
      hostKind,
      meta: snapshot.meta,
      targetFieldType: fieldType as never,
    });
    const blocking = validation.issues.filter((issue) => issue.blocking);
    if (blocking.length === 0) return;
    throw new DomainException(
      errorCodeOf(blocking[0]!),
      'Formula is invalid',
      {
        issues: blocking,
      },
      422,
    );
  }
}
