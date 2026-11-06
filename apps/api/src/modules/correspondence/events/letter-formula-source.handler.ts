import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  PROJECT_EVENTS,
  TASK_EVENTS,
  projectNodeUpdatedPayloadSchema,
  projectUpdatedPayloadSchema,
  taskUpdatedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { LetterFormulaService } from '../letters/letter-formula.service.js';

/** Ключи `cf.<uuid>` изменённых атрибутов в событии (канон ADR-0029). */
function changedFieldIds(fields: readonly string[]): string[] {
  return fields
    .filter((field) => field.startsWith('cf.'))
    .map((field) => field.slice('cf.'.length));
}

/** Номера изменённых атрибутов и глубина ячейки-источника (аккумулятор Р8). */
async function sourceNumbers(
  cells: FormulaCells,
  hostKind: 'task' | 'project' | 'node',
  hostId: string,
  fieldIds: readonly string[],
  tx: TransactionClient,
): Promise<{ numbers: number[]; depth: number }> {
  const numbers: number[] = [];
  let depth = 0;
  for (const fieldId of fieldIds) {
    const number = await cells.numberByDefinitionId(fieldId, tx);
    if (number === null) continue;
    numbers.push(number);
    const cellDepth = await cells.depthOf(hostKind, hostId, fieldId, tx);
    if (cellDepth !== null) depth = Math.max(depth, cellDepth);
  }
  return { numbers, depth };
}

/** Письма, зависящие от значений записи-источника (`v:<kind>:<id>:<n>`). */
async function letterHosts(
  cells: FormulaCells,
  hostKind: 'task' | 'project' | 'node',
  hostId: string,
  numbers: readonly number[],
  tx: TransactionClient,
): Promise<string[]> {
  if (numbers.length === 0) return [];
  const refs = await cells.dependentCellsByValues(hostKind, hostId, numbers, tx);
  return [...new Set(refs.filter((cell) => cell.hostKind === 'letter').map((cell) => cell.hostId))];
}

/** Письма, зависящие от СИСТЕМНЫХ полей источника (`system:<kind>:<id>`). */
async function letterHostsBySystem(
  cells: FormulaCells,
  hostKind: 'task' | 'project' | 'node',
  hostId: string,
  tx: TransactionClient,
): Promise<string[]> {
  const refs = await cells.dependentCellsByDepKey(`system:${hostKind}:${hostId}`, tx);
  return [...new Set(refs.filter((cell) => cell.hostKind === 'letter').map((cell) => cell.hostId))];
}

/**
 * Пересчёт формул ПИСЕМ по событиям-источникам (#632, Р4/Р8): письмо читает
 * запись по атрибуту-ссылке (`ref_field` — задача, проект, папка), значения
 * меняются в чужих модулях — их владельцы пишут свои хосты (I3), а письма
 * пересчитывает этот обработчик. Глубина волны — от ячейки-источника
 * (аккумулятор recalc_depth, Р8): сброс в 1 зациклил бы каскад между модулями.
 */
@Injectable()
export class LetterFormulaTaskSourceHandler {
  static readonly eventType = TASK_EVENTS.UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaTaskSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId, customFieldChanges: changes = [] } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const { numbers, depth } =
        changes.length > 0
          ? await sourceNumbers(
              this.cells,
              'task',
              taskId,
              changes.map((change) => change.fieldId),
              tx,
            )
          : { numbers: [], depth: 0 };
      const hosts = [
        ...new Set([
          ...(await letterHostsBySystem(this.cells, 'task', taskId, tx)),
          ...(await letterHosts(this.cells, 'task', taskId, numbers, tx)),
        ]),
      ];
      if (hosts.length === 0) return;
      this.logger.debug(
        { taskId, hosts: hosts.length },
        'Пересчёт формул писем по значениям задачи',
      );
      for (const letterId of hosts) {
        await this.formulas.recalcCells(tx, event.actorId ?? null, letterId, [], depth + 1);
      }
    });
  }
}

/** Значения проекта сменились — формулы писем со ссылкой на проект. */
@Injectable()
export class LetterFormulaProjectSourceHandler {
  static readonly eventType = PROJECT_EVENTS.UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaProjectSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { projectId } = parsed.data;
    const fieldIds = changedFieldIds(parsed.data.fields);
    await this.txRunner.run(async (tx) => {
      const { numbers, depth } =
        fieldIds.length > 0
          ? await sourceNumbers(this.cells, 'project', projectId, fieldIds, tx)
          : { numbers: [], depth: 0 };
      const hosts = [
        ...new Set([
          ...(await letterHostsBySystem(this.cells, 'project', projectId, tx)),
          ...(await letterHosts(this.cells, 'project', projectId, numbers, tx)),
        ]),
      ];
      if (hosts.length === 0) return;
      this.logger.debug(
        { projectId, hosts: hosts.length },
        'Пересчёт формул писем по значениям проекта',
      );
      for (const letterId of hosts) {
        await this.formulas.recalcCells(tx, event.actorId ?? null, letterId, [], depth + 1);
      }
    });
  }
}

/** Значения папки сменились — формулы писем со ссылкой на папку. */
@Injectable()
export class LetterFormulaNodeSourceHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaNodeSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { projectId, nodeId } = parsed.data;
    const fieldIds = changedFieldIds(parsed.data.fields);
    await this.txRunner.run(async (tx) => {
      const { numbers, depth } =
        fieldIds.length > 0
          ? await sourceNumbers(this.cells, 'node', nodeId, fieldIds, tx)
          : { numbers: [], depth: 0 };
      const hosts = [
        ...new Set([
          ...(await letterHostsBySystem(this.cells, 'node', nodeId, tx)),
          ...(await letterHosts(this.cells, 'node', nodeId, numbers, tx)),
        ]),
      ];
      if (hosts.length === 0) return;
      this.logger.debug(
        { projectId, nodeId, hosts: hosts.length },
        'Пересчёт формул писем по значениям папки',
      );
      for (const letterId of hosts) {
        await this.formulas.recalcCells(tx, event.actorId ?? null, letterId, [], depth + 1);
      }
    });
  }
}
