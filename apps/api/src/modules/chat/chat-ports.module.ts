import { Module } from '@nestjs/common';

import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { MembershipReaderProvider } from './membership-reader.provider.js';
import { CHAT_MEMBERSHIP_READER } from './membership-reader.port.js';
import { MessageLivenessProvider } from './message-liveness.provider.js';
import { CHAT_MESSAGE_LIVENESS } from './message-liveness.port.js';
import { MessageAccessProvider } from './message-access.provider.js';
import { CHAT_MESSAGE_ACCESS } from './message-access.port.js';

/**
 * Порты чтения чата (ADR-0012): тонкий модуль экспорта read-портов чужим
 * модулям-потребителям (notifications, #100) — единственная допустимая форма
 * межмодульного импорта; доменные сервисы/репозитории чата не экспортируются.
 */
@Module({
  // Читаемые беседы решающего (#952): членство ∪ чаты задач, где он решающий.
  // Направление chat → tasks-ports, обратного импорта нет — цикла нет.
  imports: [TasksPortsModule],
  providers: [
    MembershipReaderProvider,
    { provide: CHAT_MEMBERSHIP_READER, useClass: MembershipReaderProvider },
    MessageLivenessProvider,
    { provide: CHAT_MESSAGE_LIVENESS, useClass: MessageLivenessProvider },
    // Доступ к сообщению для «В задачу» и результата задачи (#37).
    MessageAccessProvider,
    { provide: CHAT_MESSAGE_ACCESS, useClass: MessageAccessProvider },
  ],
  exports: [CHAT_MEMBERSHIP_READER, CHAT_MESSAGE_LIVENESS, CHAT_MESSAGE_ACCESS],
})
export class ChatPortsModule {}
