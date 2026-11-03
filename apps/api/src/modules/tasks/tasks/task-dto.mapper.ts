import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomFieldValues,
  ProcessTypeRef,
  StageColor,
  TaskChainNode,
  TaskListItem,
  TaskPriority,
  TaskSource,
  TaskStage,
  TaskSystemState,
  UserRef,
  ProjectRef,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  PROCESS_CATALOG_READER,
  type CatalogStage,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  PROJECT_READER,
  type ProjectActor,
  type ProjectReader,
} from '../../projects/ports/project-reader.port.js';
import type { TaskListRow } from './task-row.js';

export type RefMap = Map<string, UserRef>;

/** Каталоги для строки DTO: тип и стадия — данные модуля «Процессы». */
export interface CatalogMaps {
  types: Map<string, ProcessTypeRef>;
  stages: Map<string, CatalogStage>;
}

const UNKNOWN_USER = (id: string): UserRef => ({ id, displayName: '—', avatarUrl: null });

const UNKNOWN_TYPE = (id: string): ProcessTypeRef => ({
  id,
  code: 'unknown',
  name: '—',
  category: 'task',
  icon: 'file-text',
  color: 'neutral',
});

const UNKNOWN_STAGE = (id: string): CatalogStage => ({
  id,
  workflowId: '',
  code: null,
  name: '—',
  color: 'neutral',
  sortOrder: 0,
  systemState: 'backlog',
  outcome: null,
  isInitial: false,
  archivedAt: null,
});

export function stageDto(s: {
  id: string;
  name: string;
  sortOrder: number;
  systemState: string;
  color: string;
  outcome?: string | null;
}): TaskStage {
  return {
    id: s.id,
    name: s.name,
    order: s.sortOrder,
    systemState: s.systemState as TaskSystemState,
    color: s.color as StageColor,
    ...(s.outcome ? { outcome: s.outcome as 'success' | 'cancelled' } : {}),
  };
}

/** Узел цепочки самой задачи (последний в chain). */
export function selfChainNode(row: {
  id: string;
  number: number;
  title: string;
  stageName: string;
}): TaskChainNode {
  return {
    kind: 'task',
    ref: `ПП-${row.number}`,
    label: row.title,
    state: row.stageName,
    entityId: row.id,
  };
}

/**
 * Строки задач → DTO контракта. Профили — одним батчем через read-порт
 * (ADR-0012); тип и стадия — батчем через read-порт «Процессов»
 * (ADR-0024: FK между модулями нет); проект задачи — read-порт проектов
 * (#52 Р13): ссылка видна только тому, кому виден сам проект.
 */
@Injectable()
export class TaskDtoMapper {
  constructor(
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  async refs(userIds: Iterable<string>, tx?: TransactionClient): Promise<RefMap> {
    const list = await this.profiles.findRefs([...new Set(userIds)], tx);
    return new Map(list.map((r) => [r.id, r]));
  }

  ref(map: RefMap, id: string): UserRef {
    return map.get(id) ?? UNKNOWN_USER(id);
  }

  userIdsOf(rows: TaskListRow[]): string[] {
    return rows.flatMap((r) => [r.creatorId, r.assigneeId, ...r.participants.map((p) => p.userId)]);
  }

  /** Каталоги типов и стадий для набора строк (один запрос на каждый). */
  async catalogOf(rows: TaskListRow[]): Promise<CatalogMaps> {
    const [types, stages] = await Promise.all([
      this.catalog.typeRefs([...new Set(rows.map((r) => r.typeId))]),
      this.catalog.stagesByIds([...new Set(rows.map((r) => r.stageId))]),
    ]);
    return {
      types: new Map(types.map((t) => [t.id, t])),
      stages: new Map(stages.map((s) => [s.id, s])),
    };
  }

  async toListItems(
    rows: TaskListRow[],
    tx?: TransactionClient,
    actor?: ProjectActor,
  ): Promise<TaskListItem[]> {
    const [map, catalog, projectMap] = await Promise.all([
      this.refs(this.userIdsOf(rows), tx),
      this.catalogOf(rows),
      actor
        ? this.projects
            .refsFor(actor, [
              ...new Set(rows.map((r) => r.projectId).filter((id): id is string => Boolean(id))),
            ])
            .then((refs) => new Map(refs.map((ref) => [ref.id, ref])))
        : Promise.resolve(new Map<string, ProjectRef>()),
    ]);
    return rows.map((r) => this.toListItem(r, map, catalog, projectMap));
  }

  toListItem(
    r: TaskListRow,
    map: RefMap,
    catalog: CatalogMaps,
    projects: ReadonlyMap<string, ProjectRef> = new Map(),
  ): TaskListItem {
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      type: catalog.types.get(r.typeId) ?? UNKNOWN_TYPE(r.typeId),
      stage: stageDto(catalog.stages.get(r.stageId) ?? UNKNOWN_STAGE(r.stageId)),
      personalStageId: r.placements[0]?.stageId ?? null,
      priority: r.priority as TaskPriority,
      deadline: r.deadline?.toISOString() ?? null,
      creator: this.ref(map, r.creatorId),
      assignee: this.ref(map, r.assigneeId),
      participants: r.participants
        .filter((p) => p.role === 'coexecutor')
        .map((p) => this.ref(map, p.userId)),
      // Секретный проект без участия смотрящего — null, без оракула (Т1).
      project: r.projectId ? (projects.get(r.projectId) ?? null) : null,
      parentId: r.parentId,
      // Узел структуры проекта (#467): null — «Без узла»; дерево собирает
      // клиент (ADR-0030 п.7).
      nodeId: r.nodeId,
      spentMinutes: r.spentMinutes,
      plannedMinutes: r.plannedMinutes,
      commentsCount: r.commentsCount,
      checklistDone: r.checklistDone,
      checklistTotal: r.checklistTotal,
      source: r.source as TaskSource,
      customFields: (r.customFields ?? {}) as CustomFieldValues,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
