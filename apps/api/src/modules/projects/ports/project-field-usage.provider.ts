import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { ProjectFieldScope, ProjectFieldUsageReader } from './project-field-usage.port.js';

/**
 * Реализация порта использования атрибутов в проектах (#556, Р11).
 * `?` jsonb проверяет наличие ключа; GIN `jsonb_path_ops` его не
 * поддерживает — операции редкие и администраторские (окно удаления),
 * поэтому полный скан допустим (PostgreSQL GIN jsonb_path_ops).
 */
@Injectable()
export class ProjectFieldUsageProvider implements ProjectFieldUsageReader {
  constructor(private readonly prisma: PrismaService) {}

  async countValues(scope: ProjectFieldScope, fieldId: string): Promise<number> {
    const table = scope === 'project' ? 'projects' : 'project_nodes';
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM ${Prisma.raw(`"${table}"`)}
      WHERE custom_fields ? ${fieldId}
    `);
    return Number(rows[0]?.count ?? 0);
  }
}
