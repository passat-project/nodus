import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { NOTIFICATION_EVENTS, TASK_EVENTS, type DomainEvent } from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { KIND_PRIORITY } from '../priority-resolver.js';
import { NotificationsRepository } from '../notifications.repository.js';
import { taskNotices } from '../task-notifications.js';

/**
 * Уведомления о задачах (#37): назначение, выполнение, возврат, просрочка.
 * Журнал + notification.dispatch_requested в одной транзакции (канон
 * message-sent.handler); дедуп повторной доставки — (event_id, user_id).
 * Один класс на тип события (диспетчер регистрирует по static eventType).
 */
@Injectable()
class TaskNotificationWriter {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async write(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    if (!(await this.featureFlags.isEnabled('notifications'))) return;
    const taskId = event.payload.taskId;
    if (typeof taskId !== 'string') return;
    const notices = taskNotices(event.type, event.payload, event.actorId);
    if (notices.length === 0) return;
    await this.txRunner.run(async (tx) => {
      const created = await this.repo.createFromEvent(
        notices.map((n) => ({
          id: randomUUID(),
          user_id: n.userId,
          priority: KIND_PRIORITY[n.kind],
          kind: n.kind,
          source_type: 'task',
          source_id: taskId,
          source_seq: 0n,
          actor_id: event.actorId,
          preview: n.preview,
          urgent_text: null,
          conversation_id: null,
          conversation_title: null,
          message_id: null,
          thread_root_id: null,
          event_id: event.id,
        })),
        tx,
      );
      for (const row of created) {
        await this.eventBus.emit(
          tx,
          NOTIFICATION_EVENTS.DISPATCH_REQUESTED,
          {
            snapshot: {
              notificationId: row.id,
              userId: row.user_id,
              priority: row.priority,
              kind: row.kind,
              sourceId: row.source_id,
              sourceType: 'task',
              conversationId: null,
              conversationTitle: null,
              messageId: null,
              threadRootId: null,
              preview: row.preview,
              actorName: null,
            },
            attempt: 0,
            seq: Number(row.seq),
          },
          { actorId: event.actorId, aggregateType: 'notification', aggregateId: row.id },
        );
      }
    });
  }
}

export { TaskNotificationWriter };

const handlerFor = (eventType: string) => {
  @Injectable()
  class Handler {
    static readonly eventType = eventType;
    constructor(readonly writer: TaskNotificationWriter) {}
    handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
      return this.writer.write(event);
    }
  }
  return Handler;
};

@Injectable()
export class TaskCreatedNotifyHandler extends handlerFor(TASK_EVENTS.CREATED) {}
@Injectable()
export class TaskAssignedNotifyHandler extends handlerFor(TASK_EVENTS.ASSIGNED) {}
@Injectable()
export class TaskParticipantsNotifyHandler extends handlerFor(TASK_EVENTS.PARTICIPANTS_CHANGED) {}
@Injectable()
export class TaskStageNotifyHandler extends handlerFor(TASK_EVENTS.STAGE_CHANGED) {}
@Injectable()
export class TaskOverdueNotifyHandler extends handlerFor(TASK_EVENTS.OVERDUE) {}
@Injectable()
export class TaskPressRequestedNotifyHandler extends handlerFor(TASK_EVENTS.PRESS_REQUESTED) {}
@Injectable()
export class TaskPressReturnedNotifyHandler extends handlerFor(TASK_EVENTS.PRESS_RETURNED) {}
