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

  /** Advisory-лок справочника типов на транзакцию (#631 Р10): форма типа
   *  и привязки атрибутов сериализуются между собой и с уборкой значений. */
  async lockForms(tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('nodus:project_types'))`);
  }

  /** Убрать атрибут из формы одного типа (unbind, Р3): идемпотентно.
   *  Слот формы места и есть привязка — снятие привязки чистит слот. */
  async removeFieldFromForm(
    tx: TransactionClient,
    typeId: string,
    fieldId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "project_types"
      SET "form" = jsonb_set(COALESCE("form", '{}'::jsonb), '{fields}', (
        SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE("form"->'fields', '[]'::jsonb))
             WITH ORDINALITY AS t(e, ord)
        WHERE e->>'fieldId' <> ${fieldId}::text
      ))
      WHERE "id" = ${typeId}::uuid
        AND COALESCE("form"->'fields', '[]'::jsonb)
            @> jsonb_build_array(jsonb_build_object('fieldId', ${fieldId}::text))
      RETURNING "id"
    `);
    return rows.length > 0;
  }

  /** Убрать атрибут из форм всех типов (удаление определения, #631):
   *  идемпотентно, возвращает число изменённых типов. */
  async removeFieldFromForms(tx: TransactionClient, fieldId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "project_types"
      SET "form" = jsonb_set(COALESCE("form", '{}'::jsonb), '{fields}', (
        SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE("form"->'fields', '[]'::jsonb))
             WITH ORDINALITY AS t(e, ord)
        WHERE e->>'fieldId' <> ${fieldId}::text
      ))
      WHERE COALESCE("form"->'fields', '[]'::jsonb)
            @> jsonb_build_array(jsonb_build_object('fieldId', ${fieldId}::text))
      RETURNING "id"
    `);
    return rows.length;
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
