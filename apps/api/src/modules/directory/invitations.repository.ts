import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

export type UserTokenKind = 'invite' | 'reset';

const tokenUserSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  departmentId: true,
  positionId: true,
  activatedAt: true,
  invitedAt: true,
  department: { select: { name: true } },
  position: { select: { name: true } },
} satisfies Prisma.UserSelect;

export type TokenUserRow = Prisma.UserGetPayload<{ select: typeof tokenUserSelect }>;

export interface TokenWithUser {
  id: string;
  userId: string;
  kind: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  user: TokenUserRow;
}

/** Строка под `FOR UPDATE`: сериализует reissue/cancel/accept одного сотрудника. */
export interface LockedUser {
  id: string;
  status: 'active' | 'deactivated' | 'invited';
  activatedAt: Date | null;
}

/** Кандидат автоистечения приглашения (#101): действующих invite-токенов нет. */
export interface ExpiryCandidate {
  id: string;
  activatedAt: Date | null;
}

/**
 * Доступ к `user_tokens` и служебным операциям строки-приглашения (#101).
 * Prisma — только здесь (patterns.md). В БД живёт лишь SHA-256 токена;
 * сырой токен существует один раз — в ответе API.
 */
@Injectable()
export class InvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createToken(
    data: {
      userId: string;
      kind: UserTokenKind;
      tokenHash: string;
      expiresAt: Date;
      createdBy: string | null;
    },
    tx?: TransactionClient,
  ): Promise<{ id: string; userId: string; expiresAt: Date }> {
    const client = tx ?? this.prisma;
    return client.userToken.create({
      data,
      select: { id: true, userId: true, expiresAt: true },
    });
  }

  /** Токен по хешу с данными сотрудника (GET info и accept). */
  async findByHash(kind: UserTokenKind, tokenHash: string): Promise<TokenWithUser | null> {
    return this.prisma.userToken.findFirst({
      where: { kind, tokenHash },
      select: {
        id: true,
        userId: true,
        kind: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        user: { select: tokenUserSelect },
      },
    });
  }

  /** Перевыпуск/отмена: прежние действующие ссылки того же вида гаснут. */
  async revokeActive(userId: string, kind: UserTokenKind, tx?: TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.userToken.updateMany({
      where: { userId, kind, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Одноразовость: израсходовать токен может ровно один запрос — CAS одним
   * UPDATE. Проигравший (0 строк) видит `INVITATION_ALREADY_USED`.
   */
  async markUsed(tokenId: string, tx?: TransactionClient): Promise<boolean> {
    const client = tx ?? this.prisma;
    const now = new Date();
    const result = await client.userToken.updateMany({
      where: {
        id: tokenId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    return result.count === 1;
  }

  /** Строка сотрудника под `FOR UPDATE` (порядок замков: user → tokens). */
  async lockUser(id: string, tx: TransactionClient): Promise<LockedUser | null> {
    const rows = await tx.$queryRaw<
      { id: string; status: LockedUser['status']; activated_at: Date | null }[]
    >(
      Prisma.sql`
        SELECT id, status::text AS status, activated_at
        FROM users
        WHERE id = ${id}::uuid
        FOR UPDATE
      `,
    );
    const row = rows[0];
    return row ? { id: row.id, status: row.status, activatedAt: row.activated_at } : null;
  }

  async findUserById(id: string, tx?: TransactionClient): Promise<TokenUserRow | null> {
    return (tx ?? this.prisma).user.findUnique({ where: { id }, select: tokenUserSelect });
  }

  /** Жёсткое удаление никогда не активированной строки (каскады FK). */
  async deleteUser(id: string, tx: TransactionClient): Promise<void> {
    await tx.user.delete({ where: { id } });
  }

  /**
   * Передать базовую роль «Сотрудник», если прямых ролей ещё нет: иначе после
   * авто-входа портал пуст (`permissions` из ролей). Прямая выдача ролей у
   * приглашённого запрещена — это единственный путь роли до активации.
   */
  async grantEmployeeRoleIfNone(userId: string, tx: TransactionClient): Promise<void> {
    const direct = await tx.userRole.count({ where: { userId } });
    if (direct > 0) return;
    const role = await tx.role.findUnique({ where: { code: 'employee' }, select: { id: true } });
    if (!role) return;
    await tx.userRole.createMany({ data: [{ userId, roleId: role.id }], skipDuplicates: true });
  }

  /**
   * Пачка кандидатов автоистечения: приглашённые без действующего invite-токена.
   * `FOR UPDATE SKIP LOCKED` — параллельные воркеры не делят строки.
   */
  async lockExpiryCandidates(limit: number, tx: TransactionClient): Promise<ExpiryCandidate[]> {
    const rows = await tx.$queryRaw<{ id: string; activated_at: Date | null }[]>(
      Prisma.sql`
        SELECT u.id, u.activated_at
        FROM users u
        WHERE u.status = 'invited'
          AND NOT EXISTS (
            SELECT 1 FROM user_tokens t
            WHERE t.user_id = u.id
              AND t.kind = 'invite'
              AND t.used_at IS NULL
              AND t.revoked_at IS NULL
              AND t.expires_at > now()
          )
        ORDER BY u.id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `,
    );
    return rows.map((row) => ({ id: row.id, activatedAt: row.activated_at }));
  }
}
