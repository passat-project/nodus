import { Injectable } from '@nestjs/common';
import type { CustomFieldScope } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { LetterFieldValuesReader } from './letter-field-values.port.js';

/**
 * Реализация порта значений атрибутов писем (#575): `?` jsonb проверяет
 * наличие ключа. Надгробия спама (`deleted_at`) не считаются: их значения не
 * показываются и не должны мешать удалению определения. Операция
 * администраторская (окно удаления), поэтому полный проход по `letters`
 * допустим; индекс под оператор `?` — отдельным issue (`jsonb_path_ops` его
 * не поддерживает).
 */
@Injectable()
export class LetterFieldValuesProvider implements LetterFieldValuesReader {
  constructor(private readonly prisma: PrismaService) {}

  async countValues(scope: CustomFieldScope, fieldId: string): Promise<number> {
    if (scope !== 'letter') return 0;
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM letters
      WHERE deleted_at IS NULL AND custom_fields ? ${fieldId}
    `);
    return Number(rows[0]?.count ?? 0);
  }
}
