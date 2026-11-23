import { Module } from '@nestjs/common';

import { ROLE_MEMBERSHIP_READER } from '../../core/ports/role-membership.port.js';
import { RoleMembershipProvider } from '../../core/ports/role-membership.provider.js';
import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { ChatPortsModule } from '../chat/chat-ports.module.js';
import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { DispatchHandler } from './events/dispatch.handler.js';
import { ChatMemberRemovedNotifyHandler } from './events/chat-member-removed.handler.js';
import { LetterDeletedNotifyHandler } from './events/letter-deleted.handler.js';
import { MessageDeletedHandler } from './events/message-deleted.handler.js';
import { TaskDeletedNotifyHandler } from './events/task-deleted.handler.js';
import {
  TaskAccessLostWriter,
  TaskAssigneeAccessLostHandler,
  TaskParticipantsAccessLostHandler,
} from './events/task-access-lost.handler.js';
import { MessageEditedHandler } from './events/message-edited.handler.js';
import { MessageReadHandler } from './events/message-read.handler.js';
import { MessageSentHandler } from './events/message-sent.handler.js';
import { ReactionAddedHandler } from './events/reaction-added.handler.js';
import {
  LetterArrivedNotifyHandler,
  LetterSendFailedNotifyHandler,
  MailNotificationWriter,
  MailSyncFailedNotifyHandler,
} from './events/mail-events.handler.js';
import {
  TaskAssignedNotifyHandler,
  TaskCreatedNotifyHandler,
  TaskNotificationWriter,
  TaskOverdueNotifyHandler,
  TaskParticipantsNotifyHandler,
  TaskPressRequestedNotifyHandler,
  TaskPressReturnedNotifyHandler,
  TaskPressBlockedNotifyHandler,
  TaskStageNotifyHandler,
  TaskUpdatedNotifyHandler,
} from './events/task-events.handler.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { BackgroundRetentionJob } from './retention.job.js';
import { UrgentRepeatQueue } from './urgent-repeat.queue.js';
import { UrgentRepeatWorker } from './urgent-repeat.worker.js';

/**
 * Модуль notifications (#100, ADR-0016; приоритеты — ADR-0017): журнал
 * уведомлений — истина; абстрактные приоритеты urgent/high/medium/low
 * (маппинг kind → priority — таблица в priority-resolver); ознакомление для
 * срочного. Связность — только события (I3: подписчики chat.* и task.*, эмиттер
 * notification.*) и read-порты (ADR-0012): членство чата (ChatPortsModule),
 * состав задачи (TasksPortsModule, #311).
 * Флаг `notifications` (I10): off → хендлеры тихие, эндпоинты NOT_FOUND,
 * чат жив.
 */
@Module({
  imports: [ChatPortsModule, TasksPortsModule],
  controllers: [NotificationsController],
  providers: [
    // Профили сотрудников: read-порт ADR-0012 (users — core-shared); провайдер
    // объявляется каждым модулем-потребителем (прецедент ChatModule).
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    // Держатели correspondence.register — получатели почтовых уведомлений
    // (#56, Р8): биндинг в модуле-потребителе (ADR-0012).
    RoleMembershipProvider,
    { provide: ROLE_MEMBERSHIP_READER, useClass: RoleMembershipProvider },
    NotificationsRepository,
    NotificationsService,
    MessageSentHandler,
    MessageEditedHandler,
    MessageDeletedHandler,
    // Исключён из беседы (AUD-011): её уведомления у выбывшего удаляются.
    ChatMemberRemovedNotifyHandler,
    // Письмо удалено (AUD-011): уведомления письма удаляются у всех получателей.
    LetterDeletedNotifyHandler,
    MailNotificationWriter,
    LetterArrivedNotifyHandler,
    MailSyncFailedNotifyHandler,
    LetterSendFailedNotifyHandler,
    TaskDeletedNotifyHandler,
    MessageReadHandler,
    ReactionAddedHandler,
    DispatchHandler,
    // Задачи (#37): назначение/выполнение/возврат/просрочка — по событиям task.*.
    TaskNotificationWriter,
    TaskCreatedNotifyHandler,
    TaskUpdatedNotifyHandler,
    TaskAssignedNotifyHandler,
    TaskParticipantsNotifyHandler,
    TaskStageNotifyHandler,
    TaskOverdueNotifyHandler,
    TaskPressRequestedNotifyHandler,
    TaskPressReturnedNotifyHandler,
    TaskPressBlockedNotifyHandler,
    // Снят с задачи — её уведомления уходят (#311; состав — read-порт задач).
    TaskAccessLostWriter,
    TaskParticipantsAccessLostHandler,
    TaskAssigneeAccessLostHandler,
    UrgentRepeatQueue,
    UrgentRepeatWorker,
    BackgroundRetentionJob,
  ],
})
export class NotificationsModule {}
