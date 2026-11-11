import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

import { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Единственная точка доступа модуля preferences к `user_preferences`
 * (patterns.md): одна строка на пользователя, JSONB-данные валидируются
 * контрактом на границе. Чужие строки не читаются и не пишутся — userId
 * приходит только из access-токена (I8, IDOR).
 */
@Injectable()
export class PreferencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<{ data: unknown; updatedAt: Date } | null> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId } });
    return row ? { data: row.data, updatedAt: row.updatedAt } : null;
  }

  async put(
    userId: string,
    data: Prisma.InputJsonValue,
  ): Promise<{ data: unknown; updatedAt: Date }> {
    const row = await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, data },
      update: { data },
    });
    return { data: row.data, updatedAt: row.updatedAt };
  }
}
