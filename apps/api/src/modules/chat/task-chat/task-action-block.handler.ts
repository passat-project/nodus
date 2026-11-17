import { Injectable } from '@nestjs/common';
import { TASK_EVENTS, type DomainEvent, type TaskActionPressedPayload } from '@nodus/contracts';

import { TaskActionBlockService } from './task-action-block.service.js';

/**
 * Слушатель `task.action_pressed` (#633): блок действия в чате задачи.
 * Идемпотентен по id события; регистрируется диспетчером по static eventType.
 */
@Injectable()
export class TaskActionBlockHandler {
  static readonly eventType = TASK_EVENTS.ACTION_PRESSED;

  constructor(private readonly blocks: TaskActionBlockService) {}

  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.blocks.post(event as DomainEvent<TaskActionPressedPayload>);
  }
}
