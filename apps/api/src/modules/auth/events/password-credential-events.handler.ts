import { Injectable } from '@nestjs/common';
import { DIRECTORY_EVENTS, type DomainEvent, type DomainEventHandler } from '@nodus/contracts';

import { AuthRepository } from '../auth.repository.js';

interface PasswordEventPayload {
  userId: string;
}

/**
 * Подписчик `directory.user.password_reset_issued` и
 * `directory.user.password_changed` (#101): администратор выпустил ссылку
 * сброса или сотрудник задал новый пароль — все прежние сессии гасятся.
 *
 * Стоп-лист `revokedUsers` здесь НЕ ставится осознанно (O5): маркер «+5 с»
 * отверг бы и access-токен, только что выданный авто-входом после установки
 * пароля. Остаточный риск ограничен TTL access-токена (15 мин); при появлении
 * MFA решение пересмотреть. Идемпотентен: повторный updateMany — no-op.
 */
@Injectable()
export class PasswordCredentialEventsHandler implements DomainEventHandler<PasswordEventPayload> {
  static readonly eventTypes = [
    DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
    DIRECTORY_EVENTS.USER_PASSWORD_CHANGED,
  ] as const;

  constructor(private readonly authRepository: AuthRepository) {}

  async handle(event: DomainEvent<PasswordEventPayload>): Promise<void> {
    const { userId } = event.payload;
    if (!userId) return;
    // Гасим только сессии, существовавшие до события: авто-вход после
    // установки пароля (#101) создаёт новую сессию ПОЗЖЕ и не должна быть
    // отозвана повторной доставкой password_changed.
    await this.authRepository.revokeSessionsBefore(userId, new Date(event.createdAt));
  }
}
