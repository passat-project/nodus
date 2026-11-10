import { Injectable } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { WorkflowPressRoundsReader } from '../../workflows/ports/workflow-press-rounds.port.js';
import { PressRepository } from '../press/press.repository.js';

/** Открытые раунды сбора для публикации маршрута (#434): таблицы отметок —
 *  через репозиторий модуля задач, наружу только интерфейс порта (I3). */
@Injectable()
export class WorkflowPressRoundsProvider implements WorkflowPressRoundsReader {
  constructor(private readonly press: PressRepository) {}

  async openTransitionIds(workflowId: string, tx?: TransactionClient): Promise<Set<string>> {
    return new Set(await this.press.openTransitionIdsForWorkflow(workflowId, tx));
  }
}
