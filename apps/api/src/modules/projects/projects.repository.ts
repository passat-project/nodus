import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ProjectRef } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';
import { Prisma } from '../../generated/prisma/client.js';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Экранирование LIKE (`%`, `_`, `\`): «%» в поиске — литерал, не «всё»
 *  (security-ревью #460; копия локальна — импорт репозитория crm запрещён). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (ch) => `\\${ch}`);
}

/** Строка проекта для DTO и прав; участники — отдельно (mapper). */
export const projectSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  color: true,
  typeId: true,
  portfolioId: true,
  clientId: true,
  managerId: true,
  assistantIds: true,
  visibility: true,
  status: true,
  completedAt: true,
  archivedAt: true,
  startedAt: true,
  endsAt: true,
  customFields: true,
  creatorId: true,
  createdAt: true,
  updatedAt: true,
  type: { select: { id: true, name: true, form: true } },
  portfolio: { select: { id: true, name: true } },
} as const;

export type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

/** Позиция keyset-курсора журнала: порядок (updated_at DESC, id DESC). */
export interface ProjectListCursor {
  at: string;
  id: string;
}

export interface ProjectListFilter {
  /** Проекты, где актёр участвует (любой источник); null — весь видимый срез. */
  participantOf: string | null;
  /** Роль для scope mine/role: источник участия (participant = task|member). */
  roleSource: string[] | null;
  myProjectIds: string[];
  seeAll: boolean;
  search?: string;
  visibility?: 'open' | 'secret';
  status?: 'active' | 'completed' | 'archived';
  portfolioId?: string;
  clientId?: string;
  memberId?: string;
}

export interface ProjectWriteData {
  name: string;
  description: string;
  color: string;
  typeId: string;
  portfolioId: string | null;
  managerId: string;
  assistantIds: Prisma.InputJsonValue;
  visibility: string;
  creatorId: string;
  startedAt: Date | null;
  endsAt: Date | null;
  customFields: Prisma.InputJsonValue;
}

export type ProjectFieldsPatch = Partial<Omit<ProjectWriteData, 'creatorId'>> & {
  status?: string;
  completedAt?: Date | null;
  archivedAt?: Date | null;
};

/** Данные управления (руководитель + помощники) для синка участников. */
export interface ProjectManagement {
  managerId: string;
  assistantIds: string[];
}

/**
 * Единственная точка доступа модуля к таблицам `projects` и
 * `portal_settings` (patterns.md); участники — participants.repository,
 * типы/портфели — своими репозиториями.
 */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  visibleWhere(filter: ProjectListFilter): Prisma.ProjectWhereInput {
    const and: Prisma.ProjectWhereInput[] = [];
    if (!filter.seeAll) {
      const openOrMine: Prisma.ProjectWhereInput[] = [{ visibility: 'open' }];
      if (filter.myProjectIds.length > 0) openOrMine.push({ id: { in: filter.myProjectIds } });
      and.push({ OR: openOrMine });
    }
    const mine = filter.participantOf;
    if (mine) and.push({ id: { in: filter.myProjectIds } });
    if (mine && filter.roleSource) {
      and.push({
        participants: { some: { userId: mine, source: { in: filter.roleSource } } },
      });
    }
    if (filter.memberId) and.push({ participants: { some: { userId: filter.memberId } } });
    if (filter.visibility) and.push({ visibility: filter.visibility });
    if (filter.status) and.push({ status: filter.status });
    if (filter.portfolioId) and.push({ portfolioId: filter.portfolioId });
    // Заказчик — атрибут (Р9 #631): вкладка «Проекты» карточки контрагента.
    if (filter.clientId) {
      and.push({
        customFields: { path: [SYSTEM_FIELD_IDS.projectClient], equals: filter.clientId },
      });
    }
    if (filter.search) {
      // contains маппится в LIKE: спецсимволы ввода экранированы (security
      // #460). Шифр — атрибут (Р9 #631): поиск по нему — по JSONB-ключу
      // системного поля, колонка code заморожена.
      const needle = escapeLike(filter.search);
      and.push({
        OR: [
          { name: { contains: needle, mode: 'insensitive' } },
          {
            customFields: {
              path: [SYSTEM_FIELD_IDS.projectCode],
              string_contains: needle,
            },
          },
        ],
      });
    }
    return and.length > 0 ? { AND: and } : {};
  }

  /** Страница журнала (updated_at DESC, id DESC) + 1 строка — признак следующей. */
  async findPage(
    filter: ProjectListFilter,
    cursor: ProjectListCursor | null,
    limit: number,
  ): Promise<ProjectRow[]> {
    const base = this.visibleWhere(filter);
    const baseAnd = Array.isArray(base.AND) ? base.AND : base.AND ? [base.AND] : [];
    const where: Prisma.ProjectWhereInput = { ...base };
    if (cursor) {
      const at = new Date(cursor.at);
      const keyset: Prisma.ProjectWhereInput = {
        OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: cursor.id } }],
      };
      where.AND = [...baseAnd, keyset];
    }
    return this.prisma.project.findMany({
      select: projectSelect,
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  findById(id: string, tx?: TransactionClient): Promise<ProjectRow | null> {
    const client = tx ?? this.prisma;
    return client.project.findUnique({ select: projectSelect, where: { id } });
  }

  findByIdForUpdate(tx: TransactionClient, id: string): Promise<ProjectRow | null> {
    return tx.project.findUnique({ select: projectSelect, where: { id } });
  }

  /** Блокировка строки проекта в транзакции писателя состава
   *  (`SELECT … FOR UPDATE`): писатель ждёт коммита смены видимости и видит
   *  актуальное значение — гонка join/recompute/addManual с `open→secret`
   *  закрывается (иначе ряд `joined`/`task` успевает лечь после очистки). */
  async lockForUpdate(
    tx: TransactionClient,
    id: string,
  ): Promise<{ id: string; visibility: string; status: string } | null> {
    const rows = await tx.$queryRaw<{ id: string; visibility: string; status: string }[]>(
      Prisma.sql`SELECT id, visibility, status FROM projects WHERE id = ${id}::uuid FOR UPDATE`,
    );
    return rows[0] ?? null;
  }

  /** Шифр занят другим проектом (частичный unique включает архивные). */

  async create(data: ProjectWriteData, tx: TransactionClient): Promise<ProjectRow> {
    return tx.project.create({ select: projectSelect, data: { ...data, id: randomUUID() } });
  }

  async update(tx: TransactionClient, id: string, patch: ProjectFieldsPatch): Promise<ProjectRow> {
    return tx.project.update({ select: projectSelect, where: { id }, data: patch });
  }

  /** Активность журнала: смена состава/статуса поднимает проект вручную
   *  (осорт-ось updated_at без правки полей). */
  async touch(tx: TransactionClient, id: string): Promise<void> {
    await tx.project.updateMany({ where: { id }, data: { updatedAt: new Date() } });
  }

  /** Уборка значений удалённого атрибута области `project` (#556, F1, Р11):
   *  идемпотентна, журнал не поднимает (администраторская гигиена данных). */
  async removeCustomFieldValues(tx: TransactionClient, fieldId: string): Promise<number> {
    return tx.$executeRaw(Prisma.sql`
      UPDATE projects
      SET custom_fields = custom_fields - ${fieldId}::text
      WHERE custom_fields ? ${fieldId}::text
    `);
  }

  /** Id проектов, где актёр участвует (любой источник). */
  async participantProjectIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.projectParticipant.findMany({
      select: { projectId: true },
      where: { userId },
      distinct: ['projectId'],
    });
    return rows.map((row) => row.projectId);
  }

  /** Все id открытых проектов (ветка видимости задач Р3). */
  async openProjectIds(): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      select: { id: true },
      where: { visibility: 'open' },
    });
    return rows.map((row) => row.id);
  }

  /** Все id секретных проектов (ветка hidden Р3). */
  async secretProjectIds(): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      select: { id: true },
      where: { visibility: 'secret' },
    });
    return rows.map((row) => row.id);
  }

  /** Ссылки проектов по id (read-порт): без фильтра видимости — его решает
   *  потребитель (refsFor актёру / список бесед по членству). */
  async refsByIds(
    ids: readonly string[],
  ): Promise<{ id: string; code: string | null; name: string; color: ProjectRef['color'] }[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.project.findMany({
      select: { id: true, code: true, name: true, color: true },
      where: { id: { in: [...ids] } },
    });
    return rows.map((row) => ({ ...row, color: row.color as ProjectRef['color'] }));
  }

  // ===== Настройки портала (Р7) =====

  async settingValue(key: string): Promise<unknown | null> {
    const row = await this.prisma.portalSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async putSetting(key: string, value: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.portalSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
