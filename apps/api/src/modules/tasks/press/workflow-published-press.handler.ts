import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  WORKFLOW_EVENTS,
  type DomainEvent,
  type DomainEventHandler,
  type WorkflowPublishedPayload,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  WORKFLOW_PRESS_READER,
  type WorkflowPressReader,
} from '../../workflows/ports/workflow-press-reader.port.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { PressRoundsService } from './press-rounds.service.js';

/**
 * Публикация маршрута (#434, Б1): задачи, уже стоящие в стадиях с
 * коллективной кнопкой, получают раунд сбора — с уведомлением участников.
 * Старт только из мутаций: само открытие карточки ничего не пишет.
 * Пакет по задачам стадии, как перенос `workflow_migration`: каждая задача —
 * своя короткая транзакция, чтобы публикация не держала общий лок.
 */
@Injectable()
export class WorkflowPublishedPressHandler implements DomainEventHandler<WorkflowPublishedPayload> {
  static readonly eventType = WORKFLOW_EVENTS.PUBLISHED;

  private readonly logger = new Logger(WorkflowPublishedPressHandler.name);

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly tasks: TasksRepository,
    private readonly press: PressRoundsService,
    @Inject(WORKFLOW_PRESS_READER) private readonly reader: WorkflowPressReader,
  ) {}

  async handle(event: DomainEvent<WorkflowPublishedPayload>): Promise<void> {
    if (event.payload.category !== 'task') return;
    const { workflowId } = event.payload;
    const stageIds = await this.reader.pressStageIds(workflowId);
    const taskIds = await this.tasks.liveIdsInStages(workflowId, stageIds);
    if (taskIds.length === 0) return;
    this.logger.log(`Публикация ${workflowId}: старт сбора для ${taskIds.length} задач`);
    for (const taskId of taskIds) {
      await this.txRunner.run((tx) =>
        this.press.ensureForStage(tx, taskId, { notify: true, actorId: null }),
      );
    }
  }
}
