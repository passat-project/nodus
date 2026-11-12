import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Источники участия (Р2; CHECK-домен в миграции). */
export const PARTICIPANT_SOURCES = ['manager', 'assistant', 'task', 'member', 'observer'] as const;
export type ParticipantSource = (typeof PARTICIPANT_SOURCES)[number];

/** Строка участия для DTO «Участники». */
export interface ParticipantRow {
  projectId: string;
  userId: string;
  source: string;
  observerKind: string | null;
  createdAt: Date;
}

/** Keyset-курсор списка состава: порядок (user_id, source). */
export interface MembersCursor {
  userId: string;
  source: string;
}

/**
 * Двухрежимная проекция участия (Р2): строки (проект, сотрудник, источник).
 * Руководство — из полей проекта; `task` — динамика живых задач открытых
 * проектов (идемпотентный пересчёт по событиям); `member`/`observer` —
 * ручное управление составом секретного; `observer`(joined) — вступление.
 */
@Injectable()
export class ProjectParticipantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Все строки участия проектов (для myMembership строк журнала/карточки). */
  async rowsOfProjects(projectIds: readonly string[]): Promise<ParticipantRow[]> {
    if (projectIds.length === 0) return [];
    return this.prisma.projectParticipant.findMany({
      where: { projectId: { in: [...projectIds] } },
    });
  }

  async rowsOfProject(projectId: string, tx?: TransactionClient): Promise<ParticipantRow[]> {
    return (tx ?? this.prisma).projectParticipant.findMany({ where: { projectId } });
  }

  /** Страница состава (user_id, source) + 1 строка — признак следующей. */
  async membersPage(
    projectId: string,
    cursor: MembersCursor | null,
    limit: number,
  ): Promise<ParticipantRow[]> {
    return this.prisma.projectParticipant.findMany({
      where: {
        projectId,
        ...(cursor
          ? {
              OR: [
                { userId: { gt: cursor.userId } },
                { userId: cursor.userId, source: { gt: cursor.source } },
              ],
            }
          : {}),
      },
      orderBy: [{ userId: 'asc' }, { source: 'asc' }],
      take: limit + 1,
    });
  }

  async hasRow(projectId: string, userId: string, source?: ParticipantSource): Promise<boolean> {
    const row = await this.prisma.projectParticipant.findFirst({
      select: { projectId: true },
      where: { projectId, userId, ...(source ? { source } : {}) },
    });
    return row !== null;
  }

  async add(
    tx: TransactionClient,
    rows: {
      projectId: string;
      userId: string;
      source: ParticipantSource;
      observerKind?: string | null;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx.projectParticipant.createMany({
      data: rows.map((row) => ({
        projectId: row.projectId,
        userId: row.userId,
        source: row.source,
        observerKind: row.observerKind ?? null,
      })),
      skipDuplicates: true,
    });
  }

  async remove(
    tx: TransactionClient,
    projectId: string,
    userIds: string[],
    source?: ParticipantSource,
  ): Promise<void> {
    if (userIds.length === 0) return;
    await tx.projectParticipant.deleteMany({
      where: { projectId, userId: { in: userIds }, ...(source ? { source } : {}) },
    });
  }

  /** Пересчёт источника `task` открытого проекта: истина — membersOf порта
   *  задач; идемпотентен (upsert/deleteMany, паттерн letter-usage). Заодно
   *  снимает осевшие ручные строки `member` (#714): в открытом проекте
   *  участие живёт из задач, а ручные строки — наследие secret→open до
   *  фикса. */
  async replaceTaskSource(
    tx: TransactionClient,
    projectId: string,
    userIds: readonly string[],
  ): Promise<{ added: string[]; removed: string[] }> {
    const current = await tx.projectParticipant.findMany({
      select: { userId: true },
      where: { projectId, source: 'task' },
    });
    const currentIds = new Set(current.map((row) => row.userId));
    const desired = new Set(userIds);
    const added = [...desired].filter((id) => !currentIds.has(id));
    const removed = [...currentIds].filter((id) => !desired.has(id));
    if (added.length > 0) {
      await tx.projectParticipant.createMany({
        data: added.map((userId) => ({ projectId, userId, source: 'task' })),
        skipDuplicates: true,
      });
    }
    if (removed.length > 0) {
      await tx.projectParticipant.deleteMany({
        where: { projectId, userId: { in: removed }, source: 'task' },
      });
    }
    const leftover = await tx.projectParticipant.findMany({
      select: { userId: true },
      where: { projectId, source: 'member' },
    });
    if (leftover.length > 0) {
      await tx.projectParticipant.deleteMany({ where: { projectId, source: 'member' } });
    }
    return {
      added,
      removed: [...new Set([...removed, ...leftover.map((row) => row.userId)])],
    };
  }

  /** Смена источника участия open→secret (#541): строка `task` становится
   *  `member` в той же транзакции. Если у сотрудника уже есть строка другого
   *  источника (руководство/приглашённый), task-строка снимается — уникальность
   *  (проект, сотрудник) сохраняется, роль не дублируется. */
  async convertSource(
    tx: TransactionClient,
    projectId: string,
    userIds: readonly string[],
    from: ParticipantSource,
    to: ParticipantSource,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const others = await tx.projectParticipant.findMany({
      select: { userId: true },
      where: { projectId, userId: { in: [...userIds] }, source: 'member' },
    });
    const blocked = new Set(others.map((row) => row.userId));
    if (blocked.size > 0) {
      await tx.projectParticipant.deleteMany({
        where: { projectId, userId: { in: [...blocked] }, source: from },
      });
    }
    const convert = userIds.filter((id) => !blocked.has(id));
    if (convert.length > 0) {
      await tx.projectParticipant.updateMany({
        where: { projectId, userId: { in: [...convert] }, source: from },
        data: { source: to, observerKind: null },
      });
    }
  }

  /** Синк строк руководства из полей проекта (create/update/transfer). */
  async syncManagement(
    tx: TransactionClient,
    projectId: string,
    management: { managerId: string; assistantIds: readonly string[] },
  ): Promise<{ added: string[]; removed: string[] }> {
    const rows = await tx.projectParticipant.findMany({
      where: { projectId, source: { in: ['manager', 'assistant'] } },
    });
    const currentManager = rows.find((row) => row.source === 'manager');
    const currentAssistants = new Set(
      rows.filter((row) => row.source === 'assistant').map((r) => r.userId),
    );
    const changed = new Set<string>();
    if (currentManager?.userId !== management.managerId) {
      if (currentManager) changed.add(currentManager.userId);
      changed.add(management.managerId);
      await tx.projectParticipant.deleteMany({ where: { projectId, source: 'manager' } });
      await tx.projectParticipant.createMany({
        data: [{ projectId, userId: management.managerId, source: 'manager' }],
        skipDuplicates: true,
      });
      // Новый руководитель перестаёт быть помощником.
      await tx.projectParticipant.deleteMany({
        where: { projectId, userId: management.managerId, source: 'assistant' },
      });
    }
    const desiredAssistants = new Set(management.assistantIds);
    for (const id of currentAssistants) if (!desiredAssistants.has(id)) changed.add(id);
    for (const id of desiredAssistants) if (!currentAssistants.has(id)) changed.add(id);
    const toRemove = [...currentAssistants].filter(
      (id) => !desiredAssistants.has(id) && id !== management.managerId,
    );
    if (toRemove.length > 0) {
      await tx.projectParticipant.deleteMany({
        where: { projectId, userId: { in: toRemove }, source: 'assistant' },
      });
    }
    const toAdd = [...desiredAssistants].filter(
      (id) => !currentAssistants.has(id) && id !== management.managerId,
    );
    if (toAdd.length > 0) {
      await tx.projectParticipant.createMany({
        data: toAdd.map((userId) => ({ projectId, userId, source: 'assistant' })),
        skipDuplicates: true,
      });
    }
    return { added: [...changed, ...toAdd].filter((id) => id !== undefined), removed: toRemove };
  }

  /** Руководит ли актёр проектом (руководитель или помощник) — права уровня
   *  постановщика на задачи проекта (Р12). */
  async isManagement(projectId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.projectParticipant.findFirst({
      select: { projectId: true },
      where: { projectId, userId, source: { in: ['manager', 'assistant'] } },
    });
    return row !== null;
  }

  /** Состав roster'а канала: уникальные пользователи всех источников. */
  async rosterUserIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT user_id FROM project_participants WHERE project_id = ${projectId}::uuid
    `;
    return rows.map((row) => row.user_id);
  }

  /** Строки участия сотрудника в пачке проектов (#433): источник → роль. */
  async rolesByProject(
    tx: TransactionClient | undefined,
    userId: string,
    projectIds: readonly string[],
  ): Promise<{ projectId: string; source: ParticipantSource }[]> {
    if (projectIds.length === 0) return [];
    return (tx ?? this.prisma).projectParticipant.findMany({
      where: { userId, projectId: { in: [...projectIds] } },
      select: { projectId: true, source: true },
    }) as Promise<{ projectId: string; source: ParticipantSource }[]>;
  }

  /** Сотрудники проекта с указанными источниками (#433): обратный резолв
   *  «кто держит роль» для адресатов уведомлений. */
  async userIdsBySources(
    tx: TransactionClient | undefined,
    projectId: string,
    sources: readonly ParticipantSource[],
  ): Promise<string[]> {
    if (sources.length === 0) return [];
    const rows = await (tx ?? this.prisma).projectParticipant.findMany({
      where: { projectId, source: { in: [...sources] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((row) => row.userId);
  }
}
