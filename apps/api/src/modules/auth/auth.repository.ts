import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Учётные данные для проверки пароля (passwordHash не выходит из репозитория).
 *  `passwordHash: null` — приглашённый ещё не задал пароль (#101). */
export interface UserCredentials {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  status: 'active' | 'deactivated' | 'invited';
}

/** Профиль пользователя для AuthUser/JWT — БЕЗ прав (#379, ADR-0034 п. 4):
 *  права считает порт `ROLE_MEMBERSHIP_READER`, а не join по прямым ролям. */
export interface AuthProfile {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'deactivated' | 'invited';
}

/** Идентичность для AuthUser/JWT: профиль + развёрнутые права ролей. */
export interface AuthIdentity extends AuthProfile {
  permissions: string[];
}

export interface SessionRow {
  id: string;
  userId: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  /** Время последней ротации — основа leeway-окна reuse-detection. */
  updatedAt: Date;
}

/**
 * Доступ к таблицам auth (users — только credential-часть, sessions).
 * Карточка сотрудника — репозиторий модуля directory; здесь — только то,
 * что нужно аутентификации (I3: таблицы users общие ядра, читаем минимум).
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        displayName: true,
        status: true,
      },
    });
    return user;
  }

  /** Статус до проверки пароля (#101): приглашённый получает отдельное
   *  сообщение «учётка не активирована», не раскрывая при этом хеш. */
  async findStatusByEmail(
    email: string,
  ): Promise<{ id: string; status: 'active' | 'deactivated' | 'invited' } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
  }

  /** Профиль без прав: их даёт порт ролей (прямые роли ∪ подразделение и предки). */
  async findProfileById(id: string, tx?: TransactionClient): Promise<AuthProfile | null> {
    const client = tx ?? this.prisma;
    return client.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, status: true },
    });
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.user.update({ where: { id: userId }, data: { passwordHash } });
  }
  async createSession(
    data: {
      userId: string;
      refreshTokenHash: string;
      userAgent: string | null;
      ip: string | null;
      expiresAt: Date;
    },
    tx?: TransactionClient,
  ): Promise<SessionRow> {
    const client = tx ?? this.prisma;
    return client.session.create({ data });
  }

  async findSessionById(id: string): Promise<SessionRow | null> {
    return this.prisma.session.findUnique({ where: { id } });
  }

  /**
   * Атомарная ротация compare-and-swap: предыдущий хэш ← текущий, текущий ←
   * новый, скользящий expiresAt — ТОЛЬКО если текущий хэш всё ещё равен
   * `expectedCurrentHash`, а сессия жива. Один UPDATE … WHERE: PostgreSQL
   * при конкурентном апдейте той же строки ждёт row-lock и перепроверяет
   * WHERE на свежей версии строки (READ COMMITTED), поэтому из двух
   * параллельных refresh одной cookie выигрывает ровно один; проигравший
   * получает false и перечитывает сессию (leeway-ветка сервиса).
   * Сырой SQL осознанно: updateMany Prisma не гарантирует один оператор
   * (исторически read-then-write по id), а CAS обязан быть одним UPDATE.
   * `updated_at` — явно (Prisma @updatedAt не даёт DEFAULT в БД, gotcha);
   * значение — часы приложения, как и у остальных записей сессии, чтобы
   * leeway-окно сравнивалось в одной шкале времени.
   */
  async rotateSessionIfCurrent(
    id: string,
    expectedCurrentHash: string,
    newHash: string,
    expiresAt: Date,
    tx?: TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const now = new Date();
    const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE sessions SET
        previous_refresh_token_hash = refresh_token_hash,
        refresh_token_hash = ${newHash},
        expires_at = ${expiresAt},
        updated_at = ${now}
      WHERE id = ${id}::uuid
        AND refresh_token_hash = ${expectedCurrentHash}
        AND revoked_at IS NULL
        AND expires_at > ${now}
      RETURNING id
    `);
    return rows.length === 1;
  }

  async revokeSession(id: string, tx?: TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.session.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /** Отзыв всех активных сессий пользователя (кроме exceptId — текущей). */
  async revokeAllSessions(
    userId: string,
    exceptId?: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Активные сессии пользователя для списка «Мои сессии». */
  async listActiveSessions(userId: string): Promise<SessionRow[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
