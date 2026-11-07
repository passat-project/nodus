import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  PROJECT_EVENTS,
  TASK_EVENTS,
  projectNodeDeletedPayloadSchema,
  taskDeletedPayloadSchema,
  taskEventBaseSchema,
  type DomainEvent,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { LetterFormulaService } from '../letters/letter-formula.service.js';

/** Письма, зависящие от записи-источника: системные поля и значения по
 *  префиксу dep-ключа (удалённый источник не оставляет протухших ячеек). */
async function letterHostsOfSource(
  cells: FormulaCells,
  hostKind: 'task' | 'project' | 'node',
  hostId: string,
  tx: TransactionClient,
  prefixValues = false,
): Promise<string[]> {
  const refs = [
    ...(await cells.dependentCellsByDepKey(`system:${hostKind}:${hostId}`, tx)),
    ...(prefixValues ? await cells.dependentCellsByDepPrefix(`v:${hostKind}:${hostId}:`, tx) : []),
  ];
  return [...new Set(refs.filter((cell) => cell.hostKind === 'letter').map((cell) => cell.hostId))];
}

/** Смена стадии/ответственного задачи — системные поля источника меняются
 *  без `task.updated`: формулы писем со ссылкой на задачу пересчитываются. */
@Injectable()
export class LetterFormulaTaskSystemRunner {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaTaskSystemRunner.name);
  }

  async run(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskEventBaseSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const hosts = await letterHostsOfSource(this.cells, 'task', taskId, tx);
      if (hosts.length === 0) return;
      this.logger.debug(
        { taskId, hosts: hosts.length },
        'Пересчёт формул писем по системным полям',
      );
      for (const letterId of hosts) {
        await this.formulas.recalcCells(tx, event.actorId ?? null, letterId, [], 1);
      }
    });
  }
}

@Injectable()
export class LetterFormulaStageSourceHandler {
  static readonly eventType = TASK_EVENTS.STAGE_CHANGED;
  constructor(private readonly runner: LetterFormulaTaskSystemRunner) {}
  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.runner.run(event);
  }
}

@Injectable()
export class LetterFormulaAssignedSourceHandler {
  static readonly eventType = TASK_EVENTS.ASSIGNED;
  constructor(private readonly runner: LetterFormulaTaskSystemRunner) {}
  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.runner.run(event);
  }
}

/** Удаление задачи-источника: ссылка письма стала недоступной — значение
 *  пересчитывается (`source_unavailable`/пусто), а не висит старым. */
@Injectable()
export class LetterFormulaDeletedSourceHandler {
  static readonly eventType = TASK_EVENTS.DELETED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaDeletedSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskDeletedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const hosts = await letterHostsOfSource(this.cells, 'task', taskId, tx, true);
      if (hosts.length === 0) return;
      this.logger.debug(
        { taskId, hosts: hosts.length },
        'Пересчёт формул писем после удаления задачи',
      );
      for (const letterId of hosts) {
        await this.formulas.recalcCells(tx, event.actorId ?? null, letterId, [], 1);
      }
    });
  }
}

/** Удаление папки-источника (`project.node_deleted`): ссылка письма стала
 *  недоступной — значение пересчитывается, а не висит старым. */
@Injectable()
export class LetterFormulaNodeDeletedSourceHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_DELETED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaNodeDeletedSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeDeletedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { nodeId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const hosts = await letterHostsOfSource(this.cells, 'node', nodeId, tx, true);
      if (hosts.length === 0) return;
      this.logger.debug(
        { nodeId, hosts: hosts.length },
        'Пересчёт формул писем после удаления папки',
      );
      for (const letterId of hosts) {
        await this.formulas.recalcCells(tx, event.actorId ?? null, letterId, [], 1);
      }
    });
  }
}
