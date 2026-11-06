import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { FieldBindingTarget, FieldBindingTargetReader } from './field-binding-targets.port.js';

/**
 * Реализация порта целей привязки (Р3 #631): оба справочника читаются из
 * своих таблиц модуля projects одним запросом. Списки малы (десятки строк),
 * вызов — точечный (создание/правка атрибута), кэш не нужен.
 */
@Injectable()
export class FieldBindingTargetsProvider implements FieldBindingTargetReader {
  constructor(private readonly prisma: PrismaService) {}

  async projectTypes(): Promise<FieldBindingTarget[]> {
    const rows = await this.prisma.projectType.findMany({
      select: { id: true, name: true, archivedAt: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, archived: row.archivedAt !== null }));
  }

  async nodeKinds(): Promise<FieldBindingTarget[]> {
    const rows = await this.prisma.nodeKind.findMany({
      select: { id: true, name: true, archivedAt: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, archived: row.archivedAt !== null }));
  }
}
