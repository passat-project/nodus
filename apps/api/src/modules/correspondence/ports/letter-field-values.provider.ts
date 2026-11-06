import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { LetterFieldValuesReader } from './letter-field-values.port.js';

/**
 * Реализация порта значений атрибутов писем (#575): `?` jsonb проверяет
 * наличие ключа. Надгробия (`deleted_at`) СЧИТАЮТСЯ: уборка удалённого
 * определения стирает и их значения — окно показывает реальный объём
 * потерь (#646). Операция администраторская (окно удаления), поэтому
 * полный проход по `letters` допустим; индекс под оператор `?` — отдельным
 * issue (`jsonb_path_ops` его не поддерживает).
 */
@Injectable()
export class LetterFieldValuesProvider implements LetterFieldValuesReader {
  constructor(private readonly prisma: PrismaService) {}

  async countValues(fieldId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM letters
      WHERE custom_fields ? ${fieldId}
    `);
    return Number(rows[0]?.count ?? 0);
  }
}
