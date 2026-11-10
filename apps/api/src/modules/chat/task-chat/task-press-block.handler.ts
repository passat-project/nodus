import { Injectable } from '@nestjs/common';
import {
  TASK_EVENTS,
  type DomainEvent,
  type TaskPressReturnedPayload,
  type TaskPressSubmittedPayload,
} from '@nodus/contracts';

import { TaskPressBlockService } from './task-press-block.service.js';

/**
 * Слушатели отметок сбора (#434): блок в чате задачи при сдаче и возврате.
 * Регистрируются диспетчером по static eventType (I3: chat знает о задачах
 * только событиями). «Все сотрудники» сервис сам пропускает по broadcast.
 */
@Injectable()
export class TaskPressSubmittedBlockHandler {
  static readonly eventType = TASK_EVENTS.PRESS_SUBMITTED;

  constructor(private readonly blocks: TaskPressBlockService) {}

  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.blocks.post(event as DomainEvent<TaskPressSubmittedPayload>);
  }
}

@Injectable()
export class TaskPressReturnedBlockHandler {
  static readonly eventType = TASK_EVENTS.PRESS_RETURNED;

  constructor(private readonly blocks: TaskPressBlockService) {}

  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.blocks.post(event as DomainEvent<TaskPressReturnedPayload>);
  }
}
