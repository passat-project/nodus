import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { ProjectNodesRepository } from '../project-nodes.repository.js';
import { ProjectFormulaRecalcService } from '../project-formula-recalc.service.js';

/**
 * Пересчёт формул проектов и папок по событиям реестра (#632, Р13):
 * - смена глобального значения (`fields` содержит `companyValue`) —
 *   массовый пересчёт ячеек с зависимостью `company:<n>`;
 * - удаление атрибута — ячейки, ссылавшиеся на номер (`attr_number = N`),
 *   получают `attribute_deleted` от резолвера движка.
 * Чужие хосты (задачи, письма) — не наша зона: их пересчитывают владельцы.
 */
@Injectable()
export class ProjectFormulaDefinitionHandler {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    private readonly nodes: ProjectNodesRepository,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectFormulaDefinitionHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const payload = parsed.data;
    const companyChanged = payload.fields?.includes('companyValue') === true;
    const deleted = payload.change === 'deleted';
    if (!companyChanged && !deleted) return;
    // Удаление: строки определения уже нет — номер едет в payload (#632).
    const number = payload.number ?? (await this.cells.numberByDefinitionId(payload.definitionId));
    if (number === null) return;
    const cells = (await this.cells.dependentCellsByAttrNumber(number)).filter(
      (cell) => cell.hostKind === 'project' || cell.hostKind === 'node',
    );
    if (cells.length === 0) return;
    // Папке для записи значения нужен её проект — читаем пачкой.
    const nodeHosts = cells.filter((cell) => cell.hostKind === 'node').map((cell) => cell.hostId);
    const projectOf = new Map(
      (await this.nodes.listByIds(nodeHosts)).map((node) => [node.id, node.projectId]),
    );
    const hosts = new Map<
      string,
      { hostKind: 'project' | 'node'; projectId: string; hostId: string }
    >();
    for (const cell of cells) {
      const projectId =
        cell.hostKind === 'project' ? cell.hostId : (projectOf.get(cell.hostId) ?? null);
      if (!projectId) continue;
      hosts.set(`${cell.hostKind}:${cell.hostId}`, {
        hostKind: cell.hostKind as 'project' | 'node',
        projectId,
        hostId: cell.hostId,
      });
    }
    this.logger.debug({ number, hosts: hosts.size }, 'Массовый пересчёт формул проектов и папок');
    const list = [...hosts.values()];
    // Партии по 100 хостов в отдельной транзакции: массовый пересчёт не
    // должен упираться в таймаут одной tx; повтор события идемпотентен.
    for (let index = 0; index < list.length; index += 100) {
      const batch = list.slice(index, index + 100);
      await this.txRunner.run(async (tx) => {
        for (const host of batch) {
          if (host.hostKind === 'project') {
            await this.formulas.recalcProjectCells(
              tx,
              event.actorId ?? null,
              host.projectId,
              [number],
              1,
            );
          } else {
            await this.formulas.recalcNodeCells(
              tx,
              event.actorId ?? null,
              host.projectId,
              host.hostId,
              [number],
              1,
            );
          }
        }
      });
    }
  }
}
