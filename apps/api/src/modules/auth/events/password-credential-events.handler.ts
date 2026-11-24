import { Injectable } from '@nestjs/common';
import { DIRECTORY_EVENTS, type DomainEvent, type DomainEventHandler } from '@nodus/contracts';

import { AuthRepository } from '../auth.repository.js';
import { RevokedUsersStore } from '../revoked-users.store.js';

interface PasswordEventPayload {
  userId: string;
}

/**
 * Подписчик `directory.user.password_reset_issued` и
 * `directory.user.password_changed` (#101).
 *
 * Выпуск reset-ссылки: гасим refresh-сессии И ставим стоп-лист access-токенов
 * (момент события + штатный запас, #333) — сотрудник теряет доступ сразу, а
 * не через 15 минут. Авто-вход после принятия ссылки выпускается позже маркера
 * и проходит; если вход случился в первые секунды запаса, SPA чинится
 * штатным прозрачным refresh (новая сессия не отозвана).
 *
 * Смена пароля (принятие reset-ссылки): только сессии, созданные ДО события —
 * стоп-лист здесь НЕ ставится, иначе отверг бы токен авто-входа. Остаточный
 * риск ограничен TTL access-токена (15 мин); при появлении MFA пересмотреть.
 * Идемпотентен: повторный updateMany — no-op, маркер пишется только вперёд.
 */
@Injectable()
export class PasswordCredentialEventsHandler implements DomainEventHandler<PasswordEventPayload> {
  static readonly eventTypes = [
    DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
    DIRECTORY_EVENTS.USER_PASSWORD_CHANGED,
  ] as const;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly revokedUsers: RevokedUsersStore,
  ) {}

  async handle(event: DomainEvent<PasswordEventPayload>): Promise<void> {
    const { userId } = event.payload;
    if (!userId) return;
    // Гасим только сессии, существовавшие до события: авто-вход после
    // установки пароля (#101) создаёт новую сессию ПОЗЖЕ и не должна быть
    // отозвана повторной доставкой password_changed.
    await this.authRepository.revokeSessionsBefore(userId, new Date(event.createdAt));
    if (event.type === DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED) {
      await this.revokedUsers.revoke(userId, new Date(event.createdAt));
    }
  }
}
