import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { ProjectType, ProjectTypeForm, ProjectTypeUpdateBody } from '@nodus/contracts';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const typeSelect = {
  id: true,
  name: true,
  icon: true,
  color: true,
  codeField: true,
  form: true,
  kindIds: true,
  archivedAt: true,
} as const;
type Row = Prisma.ProjectTypeGetPayload<{ select: typeof typeSelect }>;

/** Справочник типов проектов «Автоматизации» (#52; форма типа — Р10 #631). */
@Injectable()
export class ProjectTypesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: Row): ProjectType {
    return {
      id: row.id,
      name: row.name,
      icon: row.icon as ProjectType['icon'],
      color: row.color as ProjectType['color'],
      // Слоты атрибутов типа (Р10 #631): слот «Шифр» занял место политики
      // codeField; колонка code_field заморожена (не читается).
      form: (row.form ?? { fields: [] }) as ProjectTypeForm,
      kindIds: Array.isArray(row.kindIds) ? (row.kindIds as string[]) : null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  async list(includeArchived: boolean): Promise<ProjectType[]> {
    const rows = await this.prisma.projectType.findMany({
      select: typeSelect,
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async findActive(id: string): Promise<ProjectType | null> {
    const row = await this.prisma.projectType.findFirst({
      select: typeSelect,
      where: { id, archivedAt: null },
    });
    return row ? this.toDto(row) : null;
  }

  /** Тип без фильтра архива: правка полей проекта живёт и у архивного типа. */
  async findById(id: string): Promise<ProjectType | null> {
    const row = await this.prisma.projectType.findUnique({ select: typeSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  async nameTaken(name: string, excludeId?: string): Promise<boolean> {
    const row = await this.prisma.projectType.findFirst({
      select: { id: true },
      where: { name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    return row !== null;
  }

  async create(
    tx: TransactionClient,
    data: { name: string; icon?: string; color?: string; form?: ProjectTypeForm },
  ): Promise<ProjectType> {
    const row = await tx.projectType.create({
      select: typeSelect,
      data: {
        id: randomUUID(),
        ...data,
        ...(data.form ? { form: data.form as Prisma.InputJsonValue } : {}),
      },
    });
    return this.toDto(row);
  }

  /** Правка типа: имя, значок, цвет, форма (слоты атрибутов, Р10) и
   *  допустимые виды папок (#556). Валидность id видов — контроллер каталога. */
  async update(
    tx: TransactionClient,
    id: string,
    patch: ProjectTypeUpdateBody,
  ): Promise<ProjectType | null> {
    const data: Prisma.ProjectTypeUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.icon !== undefined) data.icon = patch.icon;
    if (patch.color !== undefined) data.color = patch.color;
    if (patch.form !== undefined) data.form = patch.form as Prisma.InputJsonValue;
    if (patch.kindIds !== undefined) {
      data.kindIds =
        patch.kindIds === null ? Prisma.JsonNull : (patch.kindIds as Prisma.InputJsonValue);
    }
    const result = await tx.projectType.updateMany({ where: { id }, data });
    if (result.count === 0) return null;
    const row = await tx.projectType.findUnique({ select: typeSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  async setArchived(
    tx: TransactionClient,
    id: string,
    archived: boolean,
  ): Promise<ProjectType | null> {
    const result = await tx.projectType.updateMany({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (result.count === 0) return null;
    const row = await tx.projectType.findUnique({ select: typeSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  /** Живых проектов типа (архив типа разрешён — проекты сохраняют ссылку;
   *  счётчик для вкладки «Типы проектов»). */
  async activeProjectCount(id: string): Promise<number> {
    return this.prisma.project.count({ where: { typeId: id, status: { not: 'archived' } } });
  }
}
