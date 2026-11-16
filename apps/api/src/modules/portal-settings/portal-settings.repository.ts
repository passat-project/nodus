import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

import { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Единственная точка доступа модуля «Настройки портала» к `portal_settings`
 * (patterns.md): ключ-значение, JSONB-данные валидируются контрактом на
 * границе. Чужих настроек нет — это настройки портала целиком.
 */
@Injectable()
export class PortalSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<{ value: unknown; updatedAt: Date } | null> {
    const row = await this.prisma.portalSetting.findUnique({ where: { key } });
    return row ? { value: row.value, updatedAt: row.updatedAt } : null;
  }

  async put(
    key: string,
    value: Prisma.InputJsonValue,
  ): Promise<{ value: unknown; updatedAt: Date }> {
    const row = await this.prisma.portalSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { value: row.value, updatedAt: row.updatedAt };
  }
}
