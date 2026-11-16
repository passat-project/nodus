import { Inject, Injectable } from '@nestjs/common';
import {
  Permission,
  PROJECT_EVENTS,
  type AuthUser,
  type ProjectDetail,
  type ProjectStatus,
} from '@nodus/contracts';

import type { Prisma } from '../../generated/prisma/client.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import { projectAudience } from './project-audience.js';
import { ProjectMembersService } from './project-members.service.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import {
  ProjectsRepository,
  type ProjectFieldsPatch,
  type ProjectRow,
} from './projects.repository.js';
import { ProjectsQueryService } from './projects-query.service.js';
import { ProjectsService } from './projects.service.js';

/**
 * Статусные действия и передача руководства (#52): выделены из
 * ProjectsService (лимит ответственности файла). Завершение — метка,
 * архив — заморозка (создание задач — 422), возврат в работу — руководитель
 * или project.manage (Т6); передача — только действующий руководитель,
 * прежний без иных источников становится наблюдателем-создателем (Т5).
 */
@Injectable()
export class ProjectLifecycleService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly repo: ProjectsRepository,
    private readonly participantsRepo: ProjectParticipantsRepository,
    private readonly members: ProjectMembersService,
    private readonly queries: ProjectsQueryService,
    private readonly projects: ProjectsService,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  /** Статусные действия (Р1): завершение — метка, архив — заморозка,
   *  возврат в работу — руководитель или project.manage (Т6). */
  async setStatus(user: AuthUser, id: string, status: ProjectStatus): Promise<ProjectDetail> {
    const { row } = await this.projects.loadForManage(user, id);
    // Повтор того же статуса — не событие: иначе лента «История» шумит
    // «status_changed → тот же статус» (замечание ревью).
    if (row.status === status) return this.queries.detail(user, id);
    if (
      row.status === 'archived' &&
      row.managerId !== user.id &&
      !user.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      throw DomainException.forbidden('Only the manager can restore an archived project');
    }
    const patch: ProjectFieldsPatch = {
      status,
      completedAt: status === 'completed' ? new Date() : null,
      archivedAt: status === 'archived' ? new Date() : null,
    };
    await this.txRunner.run(async (tx) => {
      const fresh = await this.lockFresh(tx, id);
      // Параллельный запрос уже применил тот же статус — повтора нет.
      if (fresh.status === status) return;
      this.assertCanSetStatus(user, fresh);
      await this.repo.update(tx, id, patch);
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.UPDATED,
        {
          projectId: id,
          fields: ['status'],
          status,
          audience: await projectAudience(this.participantsRepo, fresh),
        },
        { actorId: user.id, aggregateType: 'project', aggregateId: id },
      );
    });
    return this.queries.detail(user, id);
  }

  /** Передача руководства (Т5): прежний руководитель без иных источников —
   *  наблюдатель-создатель. */
  async transfer(user: AuthUser, id: string, managerId: string): Promise<ProjectDetail> {
    const { row } = await this.projects.loadForManage(user, id);
    if (row.managerId !== user.id) {
      throw DomainException.forbidden('Only the manager can transfer management');
    }
    // Архив — заморозка: смена руководства — тоже правка поля проекта.
    if (row.status === 'archived' && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
      throw DomainException.forbidden('Archived project fields are managed by project.manage');
    }
    if ((await this.profiles.filterActiveUserIds([managerId])).length === 0) {
      throw DomainException.notFound('User not found');
    }
    await this.txRunner.run(async (tx) => {
      // Права — по свежей строке под FOR UPDATE (#866, AUD-013): между
      // снимком и транзакцией руководство могли передать параллельно.
      const fresh = await this.lockFresh(tx, id);
      this.assertManagement(user, fresh);
      if (fresh.managerId !== user.id) {
        throw DomainException.forbidden('Only the manager can transfer management');
      }
      if (fresh.status === 'archived' && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
        throw DomainException.forbidden('Archived project fields are managed by project.manage');
      }
      const assistantIds = (fresh.assistantIds as string[]).filter((aid) => aid !== managerId);
      await this.repo.update(tx, id, {
        managerId,
        assistantIds: assistantIds as Prisma.InputJsonValue,
      });
      // Прежний руководитель без иных источников — наблюдатель-создатель;
      // создатель (если это другое лицо) уже держит свою строку.
      const rows = await this.participantsRepo.rowsOfProject(id);
      if (!previousManagerKeepsRole(rows, user.id)) {
        await this.participantsRepo.add(tx, [
          { projectId: id, userId: user.id, source: 'observer', observerKind: 'creator' },
        ]);
      }
      await this.members.syncManagement(
        tx,
        id,
        { managerId, assistantIds },
        { extraChanged: [user.id, managerId] },
      );
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.UPDATED,
        {
          projectId: id,
          fields: ['managerId', 'assistantIds'],
          audience: [
            ...new Set([
              ...(await projectAudience(this.participantsRepo, fresh)),
              managerId,
              user.id,
            ]),
          ],
        },
        { actorId: user.id, aggregateType: 'project', aggregateId: id },
      );
    });
    return this.queries.detail(user, id);
  }

  /** Свежая строка проекта под `FOR UPDATE` — первым шагом транзакции, как в
   *  PATCH проекта (`ProjectsService.update`), чтобы порядок блокировок был
   *  единым: проект → участники/структура. */
  private async lockFresh(tx: TransactionClient, id: string): Promise<ProjectRow> {
    const locked = await this.repo.lockForUpdate(tx, id);
    if (!locked) throw DomainException.notFound('Project not found');
    const fresh = await this.repo.findById(id, tx);
    if (!fresh) throw DomainException.notFound('Project not found');
    return fresh;
  }

  /** Права руководства по свежей строке: руководитель, помощник или
   *  project.manage — как `ProjectsService.loadForManage` до транзакции. */
  private assertManagement(user: AuthUser, fresh: ProjectRow): void {
    const assistantIds = Array.isArray(fresh.assistantIds) ? (fresh.assistantIds as string[]) : [];
    const isManagement = fresh.managerId === user.id || assistantIds.includes(user.id);
    if (!isManagement && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
      throw DomainException.forbidden('Only project management can edit the project');
    }
  }

  /** Статусное действие по свежей строке: управление + заморозка архива
   *  (возврат в работу — только руководитель или project.manage, Т6). */
  private assertCanSetStatus(user: AuthUser, fresh: ProjectRow): void {
    this.assertManagement(user, fresh);
    if (
      fresh.status === 'archived' &&
      fresh.managerId !== user.id &&
      !user.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      throw DomainException.forbidden('Only the manager can restore an archived project');
    }
  }
}

/** Прежний руководитель держит иной источник участия (помощник/задачи/...). */
function previousManagerKeepsRole(
  rows: readonly { userId: string; source: string }[],
  userId: string,
): boolean {
  return rows.some(
    (p) => p.userId === userId && ['assistant', 'task', 'member', 'observer'].includes(p.source),
  );
}
