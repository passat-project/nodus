import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomFieldFormulas,
  CustomFieldType,
  FormulaCellError,
  FormulaHostKind,
  FormulaNode,
  FormulaResponse,
} from '@nodus/contracts';
import { ErrorCode, FORMULA_LIMITS } from '@nodus/contracts';
import type { FormulaValidationIssue } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type {
  FormulaCellRef,
  FormulaCells,
  FormulaComputation,
  FormulaRecalcOutcome,
  FormulaSaveArgs,
  FormulaStateMap,
} from '../ports/formula-cells.port.js';
import { FORMULA_ENGINE, type FormulaEngine } from '../ports/formula-engine.port.js';
import { FormulaCellsRepository, type FormulaCellRow } from './formula-cells.repository.js';
import { FormulaContextService, type FormulaContext } from './formula-context.service.js';
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
    for (const cell of cells) {
      const formulas: CustomFieldFormulas = result.get(cell.hostId) ?? {};
      formulas[cell.fieldId] = {
        origin: 'own',
        ...(cell.error ? { error: asCellError(cell.error) } : {}),
      };
      result.set(cell.hostId, formulas);
    }
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

    const outcome = await this.compute(args.ast, context, snapshot, definition.id);
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
    if (!cell) return { value: null, error: null, changed: false, silent: true };

    if (depth > FORMULA_LIMITS.cascadeDepth) {
      const error: FormulaCellError = {
        code: 'cycle',
        message: 'formula recalculation cycle detected',
      };
      await this.repo.updateState(tx, cell.id, { error, depth });
      return { value: null, error, changed: true, silent: true };
    }

    const snapshot = await this.meta.snapshot(tx);
    const ast = cell.ast as FormulaNode;
    const context = await this.context.build(
      { hostKind: ref.hostKind, hostId: ref.hostId, asts: [ast], snapshot },
      tx,
    );
    if (!context) {
      await this.repo.deleteByHost(tx, ref.hostKind, ref.hostId);
      return { value: null, error: null, changed: false, silent: true };
    }
    const definition = snapshot.byId.get(ref.fieldId);
    if (!definition) {
      await this.repo.remove(tx, ref.hostKind, ref.hostId, ref.fieldId);
      return { value: null, error: null, changed: false, silent: true };
    }

    const outcome = await this.compute(ast, context, snapshot, ref.fieldId);
    const previous = context.host.values[ref.fieldId] ?? null;
    const changed = !sameFormulaValue(previous, outcome.value);
    await this.repo.replaceDeps(tx, cell.id, context.depKeys);
    await this.repo.updateState(tx, cell.id, { error: outcome.error, depth });
    return { ...outcome, changed, silent: false };
  }

  async cleanupHost(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
  ): Promise<void> {
    await this.repo.deleteByHost(tx, hostKind, hostId);
  }

  /** Вычисление + материализация: ошибка ячейки важнее значения (Р13). */
  private async compute(
    ast: FormulaNode,
    context: FormulaContext,
    snapshot: FormulaRegistrySnapshot,
    fieldId: string,
  ): Promise<FormulaComputation> {
    const evaluation = this.engine.evaluate(ast, context.resolver);
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
    const materialized = await this.values.materialize(
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
      { issues: blocking },
      422,
    );
  }
}

/** Код отказа API по блокирующей проблеме формулы (каталог Р13). */
function errorCodeOf(issue: FormulaValidationIssue): ErrorCode {
  switch (issue.code) {
    case 'type_mismatch':
      return ErrorCode.FORMULA_TYPE_MISMATCH;
    case 'source_forbidden':
    case 'selector_forbidden':
      return ErrorCode.FORMULA_SOURCE_FORBIDDEN;
    case 'depth':
    case 'nodes':
    case 'sources':
    case 'literal_text':
      return ErrorCode.FORMULA_LIMIT_EXCEEDED;
    default:
      return ErrorCode.FORMULA_AST_INVALID;
  }
}

function refOf(row: FormulaCellRow): FormulaCellRef {
  return {
    cellId: row.id,
    hostKind: row.hostKind as FormulaHostKind,
    hostId: row.hostId,
    fieldId: row.fieldId,
  };
}

/** Ошибка ячейки из JSONB (терпимо к старым формам). */
function asCellError(raw: unknown): FormulaCellError {
  const value = raw as Partial<FormulaCellError> | null;
  return {
    code: (value?.code ?? 'eval_failed') as FormulaCellError['code'],
    message: value?.message ?? 'formula evaluation failed',
    ...(typeof value?.number === 'number' ? { number: value.number } : {}),
  };
}
