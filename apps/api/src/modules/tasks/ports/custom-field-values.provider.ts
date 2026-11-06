import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { CustomFieldValuesReader } from './custom-field-values.port.js';

/**
 * Реализация порта значений атрибутов задач (#431, #631): `?` jsonb проверяет
 * наличие ключа — частичный GIN-индекс `tasks_custom_fields_gin` задействуется
 * планировщиком на больших объёмах. Мягко удалённые задачи СЧИТАЮТСЯ:
 * уборка удалённого определения стирает и их значения, окно обязано
 * показать реальный объём потерь (#646).
 */
@Injectable()
export class TaskCustomFieldValuesProvider implements CustomFieldValuesReader {
  constructor(private readonly prisma: PrismaService) {}

  async countValues(fieldId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM tasks
      WHERE custom_fields ? ${fieldId}
    `);
    return Number(rows[0]?.count ?? 0);
  }
}
