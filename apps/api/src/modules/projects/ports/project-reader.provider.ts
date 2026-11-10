/* eslint-disable nodus-internal/max-lines-warn -- чтения места счёта (#630) держат видимость и дерево в одной точке порта */
import { Injectable } from '@nestjs/common';
import { ErrorCode, Permission, type ProjectRef, type ProjectRole } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import {
  ProjectParticipantsRepository,
  type ParticipantSource,
} from '../project-participants.repository.js';
import { ProjectNodesRepository } from '../project-nodes.repository.js';
import { ProjectsRepository } from '../projects.repository.js';
import type {
  NumberNodeContext,
  NumberProjectContext,
  NumberProjectContexts,
  ProjectActor,
  ProjectChatReader,
  ProjectReader,
  ProjectViewScope,
} from './project-reader.port.js';

const EMPTY_SCOPE: ProjectViewScope = { visibleProjectIds: [], hiddenProjectIds: [] };
/** TTL кэша множеств видимости (Р3): паттерн feature-flag.service.ts. */
const SCOPE_TTL_MS = 5_000;

/** Бизнес-роль проекта → источники проекции `ProjectParticipant.source`.
 *  `participant` объединяет динамический `task` и ручной `member` (ADR-0030). */
const SOURCES_BY_ROLE: Record<ProjectRole, readonly ParticipantSource[]> = {
  manager: ['manager'],
  assistant: ['assistant'],
  participant: ['task', 'member'],
  observer: ['observer'],
};
const ROLE_BY_SOURCE: Record<ParticipantSource, ProjectRole> = {
  manager: 'manager',
  assistant: 'assistant',
  task: 'participant',
  member: 'participant',
  observer: 'observer',
};

/**
 * Реализация read-портов проектов (ADR-0012). Флаг `projects` выключен —
 * порты нейтральны: пустые множества, refs без строк, проверки пропускают
 * (I10 — задачи и письма не должны зависеть от подъёма модуля).
 */
@Injectable()
export class ProjectReaderProvider implements ProjectReader, ProjectChatReader {
  private readonly scopeCache = new Map<string, { scope: ProjectViewScope; expiresAt: number }>();

  constructor(
    private readonly projects: ProjectsRepository,
    private readonly participants: ProjectParticipantsRepository,
    private readonly nodes: ProjectNodesRepository,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async enabled(): Promise<boolean> {
    return this.featureFlags.isEnabled('projects');
  }

  async refsFor(actor: ProjectActor, ids: readonly string[]): Promise<ProjectRef[]> {
    if (ids.length === 0) return [];
    if (!(await this.enabled())) return [];
    // Без кэша: ответ мутации («создал задачу → project в DTO») не должен
    // зависеть от TTL/доставки инвалидации (фиды — кэшированный путь).
    const scope = await this.buildScope(actor);
    const visible = new Set(scope.visibleProjectIds);
    const found = await this.projects.refsByIds([...ids]);
    return found.filter((ref) => visible.has(ref.id));
  }

  /** Сброс кэша множеств (события project.* меняют состав видимости). */
  invalidateScopeCache(): void {
    this.scopeCache.clear();
  }

  async viewScopeFor(actor: ProjectActor): Promise<ProjectViewScope> {
    if (!(await this.enabled())) return EMPTY_SCOPE;
    const cached = this.scopeCache.get(actor.id);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.scope;
    const scope = await this.buildScope(actor);
    this.scopeCache.set(actor.id, { scope, expiresAt: now + SCOPE_TTL_MS });
    return scope;
  }

  /** Без кэша — путь записи значения-ссылки (#646). */
  async freshViewScopeFor(actor: ProjectActor): Promise<ProjectViewScope> {
    if (!(await this.enabled())) return EMPTY_SCOPE;
    return this.buildScope(actor);
  }

  private async buildScope(actor: ProjectActor): Promise<ProjectViewScope> {
    const myProjectIds = await this.projects.participantProjectIds(actor.id);
    const mine = new Set(myProjectIds);
    const seeSecret = actor.permissions.includes(Permission.PROJECT_VIEW_SECRET);
    const openIds = await this.projects.openProjectIds();
    const secretIds = await this.projects.secretProjectIds();
    const visible = seeSecret
      ? [...new Set([...openIds, ...secretIds])]
      : [...new Set([...openIds, ...myProjectIds])];
    const hidden = seeSecret ? [] : secretIds.filter((id) => !mine.has(id));
    return { visibleProjectIds: visible, hiddenProjectIds: hidden };
  }

  async numberContext(
    projectIds: readonly string[],
    nodeIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<NumberProjectContexts> {
    const seedNodes = await this.nodes.listByIds(nodeIds, tx);
    const seedProjects = await this.projects.numberContext(
      [...new Set([...projectIds, ...seedNodes.map((node) => node.projectId)])],
      tx,
    );
    const allProjects = await this.projects.numberContext(
      seedProjects.map((project) => project.id),
      tx,
    );
    const allNodes = await this.nodes.listByProjects(
      allProjects.map((project) => project.id),
      tx,
    );
    return {
      projects: allProjects.map(toProjectContext),
      nodes: uniqueNodes([...allNodes, ...seedNodes]).map(toNodeContext),
    };
  }

  async numberHostsOfTypes(
    projectTypeIds: readonly string[],
    nodeKindIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<NumberProjectContexts> {
    const [projects, nodes] = await Promise.all([
      this.projects.listByTypes(projectTypeIds, tx),
      this.nodes.listByKinds(nodeKindIds, tx),
    ]);
    const allProjectIds = [
      ...new Set([
        ...projects.map((project) => project.id),
        ...nodes.map((node) => node.projectId),
      ]),
    ];
    const allProjects = await this.projects.numberContext(allProjectIds, tx);
    const allNodes = await this.nodes.listByProjects(allProjectIds, tx);
    return {
      projects: allProjects.map(toProjectContext),
      nodes: uniqueNodes([...allNodes, ...nodes]).map(toNodeContext),
    };
  }

  async assertTaskProjectVisible(actor: ProjectActor, projectId: string): Promise<void> {
    if (!(await this.enabled())) return;
    // Валидация записи — БЕЗ кэша: «создал проект → сразу задача» не должна
    // зависеть от TTL/доставки инвалидации (фиды — кэшированный путь).
    const scope = await this.buildScope(actor);
    if (!scope.visibleProjectIds.includes(projectId)) {
      // Без оракула секретности: скрытый и несуществующий — один ответ (Т1).
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is not available', {
        projectId,
      });
    }
    // Архив — заморозка: новые задачи в архивный проект не создаются (Р1).
    const project = await this.projects.findById(projectId);
    if (!project || project.status === 'archived') {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is archived', {
        projectId,
      });
    }
  }

  async assertProjectAttachable(projectId: string): Promise<void> {
    if (!(await this.enabled())) return;
    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is not available', {
        projectId,
      });
    }
    if (project.status === 'archived') {
      // Архив — заморозка: новых привязок нет (Р1).
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is archived', {
        projectId,
      });
    }
  }

  async assertMembersAllowed(projectId: string, userIds: readonly string[]): Promise<void> {
    if (!(await this.enabled())) return;
    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is not available', {
        projectId,
      });
    }
    if (project.status === 'archived') {
      // Архив — заморозка: новых задач нет (Р1).
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is archived', {
        projectId,
      });
    }
    if (project.visibility !== 'secret') return;
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    const rows = await this.participants.rowsOfProject(projectId);
    // Наблюдатель секретного проекта — только просмотр (Р2): получать задачи
    // (и права правки) он не может; участники для назначения — руководство,
    // member и task-источники.
    const members = new Set(
      rows.filter((row) => row.source !== 'observer').map((row) => row.userId),
    );
    const outsiders = unique.filter((id) => !members.has(id));
    if (outsiders.length > 0) {
      throw new DomainException(
        ErrorCode.PROJECT_TASK_MEMBERS_INVALID,
        'Task members must be project participants (secret project)',
        { projectId, userIds: outsiders },
      );
    }
  }

  async projectTaskRights(actorId: string, projectId: string): Promise<{ supervisor: boolean }> {
    if (!(await this.enabled())) return { supervisor: false };
    return { supervisor: await this.participants.isManagement(projectId, actorId) };
  }

  async lockNodeStructure(tx: TransactionClient, projectId: string): Promise<void> {
    if (!(await this.enabled())) return;
    await this.nodes.lockStructure(tx, projectId);
  }

  async assertNodeAllowed(projectId: string, nodeId: string): Promise<void> {
    if (!(await this.enabled())) return;
    // Архив — заморозка структуры (симметрично loadForStructureManage):
    // задача не переставляется по зафиксированному дереву. Снятие узла
    // (nodeId=null) сюда не приходит — вынос из структуры не блокируется.
    const project = await this.projects.findById(projectId);
    if (project?.status === 'archived') {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is archived', { projectId });
    }
    // Без оракула: чужой проект, чужой узел и несуществующий узел — один
    // ответ (узел структуры не раскрывает соседние проекты).
    const node = await this.nodes.findById(nodeId);
    if (!node || node.projectId !== projectId) {
      throw new DomainException(ErrorCode.PROJECT_NODE_INVALID, 'Node is not available', {
        nodeId,
      });
    }
  }

  async visibilityOf(projectId: string): Promise<'open' | 'secret' | null> {
    if (!(await this.enabled())) return null;
    const project = await this.projects.findById(projectId);
    return project ? (project.visibility as 'open' | 'secret') : null;
  }

  /** Роли сотрудника в проектах (#433): источник решающих «роль в проекте». */
  async rolesIn(
    userId: string,
    projectIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<Record<string, ProjectRole[]>> {
    if (!(await this.enabled()) || projectIds.length === 0) return {};
    const rows = await this.participants.rolesByProject(tx, userId, projectIds);
    const result: Record<string, ProjectRole[]> = {};
    for (const row of rows) {
      const role = ROLE_BY_SOURCE[row.source];
      const list = (result[row.projectId] ??= []);
      if (!list.includes(role)) list.push(role);
    }
    return result;
  }

  /** Кто держит роль в проекте (#433): адресаты уведомлений. */
  async usersWithRoles(
    projectId: string,
    roles: readonly ProjectRole[],
    tx?: TransactionClient,
  ): Promise<string[]> {
    if (!(await this.enabled()) || roles.length === 0) return [];
    const sources = [...new Set(roles.flatMap((role) => SOURCES_BY_ROLE[role]))];
    return this.participants.userIdsBySources(tx, projectId, sources);
  }

  // ===== ProjectChatReader (Р8) =====

  async roster(projectId: string): Promise<{ managerId: string; memberIds: string[] } | null> {
    if (!(await this.enabled())) return null;
    const project = await this.projects.findById(projectId);
    if (!project) return null;
    const memberIds = await this.participants.rosterUserIds(projectId);
    return { managerId: project.managerId, memberIds };
  }

  async canView(projectId: string, actor: ProjectActor): Promise<boolean> {
    if (!(await this.enabled())) return false;
    const project = await this.projects.findById(projectId);
    if (!project) return false;
    if (project.visibility === 'open') return true;
    return (
      (await this.participants.hasRow(projectId, actor.id)) ||
      actor.permissions.includes(Permission.PROJECT_VIEW_SECRET)
    );
  }

  async canPost(projectId: string, actor: ProjectActor): Promise<boolean> {
    if (!(await this.enabled())) return false;
    if (actor.permissions.includes(Permission.PROJECT_CHANNEL_POST)) return true;
    return this.participants.isManagement(projectId, actor.id);
  }

  async refs(ids: readonly string[]): Promise<ProjectRef[]> {
    if (ids.length === 0 || !(await this.enabled())) return [];
    return this.projects.refsByIds([...ids]);
  }
}

function toProjectContext(row: {
  id: string;
  name: string;
  typeId: string;
  portfolioId: string | null;
  customFields: unknown;
  createdAt: Date;
}): NumberProjectContext {
  return {
    id: row.id,
    name: row.name,
    typeId: row.typeId,
    portfolioId: row.portfolioId,
    values: asValues(row.customFields),
    createdAt: row.createdAt,
  };
}

function toNodeContext(row: {
  id: string;
  projectId: string;
  parentId: string | null;
  kindId: string;
  name: string;
  customFields: unknown;
  createdAt: Date;
}): NumberNodeContext {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    kindId: row.kindId,
    name: row.name,
    values: asValues(row.customFields),
    createdAt: row.createdAt,
  };
}

function uniqueNodes<T extends { id: string }>(nodes: readonly T[]): T[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function asValues(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}
