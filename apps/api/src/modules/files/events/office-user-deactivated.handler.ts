import { Injectable } from '@nestjs/common';
import { DIRECTORY_EVENTS, type DomainEvent, type DomainEventHandler } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import { AuditRepository } from '../../../core/audit/audit.repository.js';
import { OfficeCommandService } from '../office/office-command.service.js';
import { OfficeSessionsStore } from '../office/office-sessions.store.js';

interface UserDeactivatedPayload {
  userId: string;
}

/**
 * Подписчик `directory.user.deactivated` (#356): разрывает офисные сессии
 * правки уволенного в Document Server. JWT конфигурации редактора живёт 24 ч,
 * и DS не перепроверяет статус пользователя при сохранении — без `drop`
 * уволенный продолжает писать файл через открытый редактор.
 *
 * Реестр открытых ключей — Redis (`OfficeSessionsStore`); при недоступном
 * Redis/DS подписчик бросает, и диспетчер повторит событие (access-события
 * не снимаются с повторов). Постоянные ошибки команды (неверный токен)
 * логируются, аудируются и не блокируют повтор остальных ключей.
 */
@Injectable()
export class OfficeUserDeactivatedHandler implements DomainEventHandler<UserDeactivatedPayload> {
  static readonly eventType = DIRECTORY_EVENTS.USER_DEACTIVATED;

  constructor(
    private readonly sessions: OfficeSessionsStore,
    private readonly commands: OfficeCommandService,
    private readonly audit: AuditRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OfficeUserDeactivatedHandler.name);
  }

  async handle(event: DomainEvent<UserDeactivatedPayload>): Promise<void> {
    const { userId } = event.payload;
    if (!userId) return;
    const keys = await this.sessions.keysOf(userId);
    if (keys.length === 0) return;

    // Параллельно: drop — сетевой вызов DS, последовательный цикл держал бы
    // однопроходный диспетчер outbox на каждом документе.
    const results = await Promise.allSettled(
      keys.map(async (documentKey) => {
        const result = await this.commands.dropUser(documentKey, userId);
        if (result === 'permanent') {
          await this.audit.append({
            actorId: null,
            action: 'files.office_drop_failed',
            entityType: 'user',
            entityId: userId,
            details: { documentKey },
          });
        }
      }),
    );
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failed.length > 0) {
      this.logger.warn(
        { userId, failed: failed.length, total: keys.length, err: failed[0]?.reason },
        'office sessions: drop не удался, событие будет повторено',
      );
      // Список ключей не чистим: повтор события доберёт упавшие документы.
      throw new Error('Office sessions drop failed');
    }
    await this.sessions.clear(userId);
  }
}
