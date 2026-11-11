import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  Permission,
  type AuthUser,
  type ListProjectsQuery,
  type ProjectDetail,
  type ProjectHistoryEntry,
  type ProjectListItem,
  type ProjectStatus,
} from '@nodus/contracts';

import { decodeCursor, encodeCursor } from '../../core/pagination/cursor.util.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import { ProjectDtoMapper } from './project-dto.mapper.js';
import { ProjectHistoryRepository, PROJECT_EVENT_KINDS } from './project-history.repository.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectsRepository } from './projects.repository.js';

const historyCursorSchema = z.object({ seq: z.string().regex(/^\d+$/) });

/**
 * Журнал и карточка проектов (чтение, #52): вынесено из ProjectsService
 * (лимит ответственности файла). Журнал — видимый срез (открытые +
 * секретные участия; view_secret видит всё) с фильтрами и keyset-курсором.
 */
@Injectable()
export class ProjectsQueryService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly participantsRepo: ProjectParticipantsRepository,
    private readonly historyRepo: ProjectHistoryRepository,
    private readonly mapper: ProjectDtoMapper,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  async list(
    user: AuthUser,
    query: ListProjectsQuery,
  ): Promise<{ items: ProjectListItem[]; nextCursor: string | null }> {
    const myProjectIds = await this.repo.participantProjectIds(user.id);
    const roleSource =
      query.role === undefined
        ? null
        : query.role === 'participant'
          ? ['task', 'member']
          : [query.role];
    const filter = {
      participantOf: query.scope === 'mine' || query.role !== undefined ? user.id : null,
      roleSource,
      myProjectIds,
      seeAll: user.permissions.includes(Permission.PROJECT_VIEW_SECRET),
      search: query.search,
      visibility: query.visibility,
      status: query.status,
      portfolioId: query.portfolioId,
      clientId: query.clientId,
      memberId: query.memberId,
    };
    const cursor = query.cursor
      ? decodeCursor(query.cursor, z.object({ at: z.iso.datetime(), id: z.uuid() }))
      : null;
    const rows = await this.repo.findPage(filter, cursor, query.limit);
    const page = rows.slice(0, query.limit);
    const participants = await this.participantsRepo.rowsOfProjects(page.map((row) => row.id));
    const items = await this.mapper.toListItems(
      page.map((row) => ({
        row,
        participants: participants.filter((p) => p.projectId === row.id),
        viewer: user,
      })),
    );
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ at: last.updatedAt.toISOString(), id: last.id })
        : null;
    return { items, nextCursor };
  }

  async detail(user: AuthUser, id: string): Promise<ProjectDetail> {
    const row = await this.assertVisible(user, id);
    return this.detailOf(user, row);
  }

  /** Карточка по уже проверенной строке (create/update возвращают detail). */
  async detailOf(user: AuthUser, row: { id: string }): Promise<ProjectDetail> {
    const fresh = await this.repo.findById(row.id);
    if (!fresh) throw DomainException.notFound('Project not found');
    const participants = await this.participantsRepo.rowsOfProject(row.id);
    return this.mapper.toDetail({ row: fresh, participants, viewer: user });
  }

  /**
   * История проекта (вкладка «История»): страница outbox-событий агрегата
   * (I9), новые первыми. Видимость — как у карточки: секретный проект 404
   * для неучастника, чтобы лента не была оракулом существования.
   * Секретная эпоха (вариант Б #748): у открытого проекта не-участник видит
   * ленту только с момента последнего раскрытия; участие и
   * `project.view_secret` — полную.
   */
  async history(
    user: AuthUser,
    id: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ items: ProjectHistoryEntry[]; nextCursor: string | null }> {
    const row = await this.assertVisible(user, id);
    const after = cursor ? BigInt(decodeCursor(cursor, historyCursorSchema).seq) : null;
    const minSeq = await this.historyFloor(user, id, row);
    const rows = await this.historyRepo.findPage(id, after, limit, minSeq);
    const page = rows.slice(0, limit);
    const userIds = new Set<string>();
    for (const row of page) {
      if (row.actorId) userIds.add(row.actorId);
      for (const userId of changedUsersOf(row.payload)) userIds.add(userId);
    }
    const refs = new Map((await this.profiles.findRefs([...userIds])).map((ref) => [ref.id, ref]));
    const items: ProjectHistoryEntry[] = page.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const status = typeof payload.status === 'string' ? (payload.status as ProjectStatus) : null;
      const kind = PROJECT_EVENT_KINDS[row.type] ?? 'updated';
      return {
        id: row.id,
        kind: kind === 'updated' && status !== null ? 'status_changed' : kind,
        actor: row.actorId ? (refs.get(row.actorId) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
        fields: Array.isArray(payload.fields)
          ? payload.fields.filter((field): field is string => typeof field === 'string')
          : [],
        status,
        users: changedUsersOf(row.payload).flatMap((userId) => refs.get(userId) ?? []),
        name: typeof payload.name === 'string' ? payload.name : null,
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor({ seq: last.seq.toString() }) : null,
    };
  }

  /**
   * Нижняя граница ленты (#748, вариант Б): открытый проект — не-участник
   * без `project.view_secret` видит историю с последнего раскрытия; граница
   * читается из журнала событий (append-only, I9), существующие записи не
   * переписываются. Участие и надзор — полная лента (null).
   */
  private async historyFloor(
    user: AuthUser,
    id: string,
    row: { visibility: string },
  ): Promise<bigint | null> {
    if (row.visibility !== 'open' || user.permissions.includes(Permission.PROJECT_VIEW_SECRET)) {
      return null;
    }
    if (await this.participantsRepo.hasRow(id, user.id)) return null;
    return this.historyRepo.findLastVisibilityChangeSeq(id);
  }

  /** Видимость карточки: секретный — участие или view_secret (404 без оракула). */
  private async assertVisible(user: AuthUser, id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw DomainException.notFound('Project not found');
    if (row.visibility === 'secret') {
      const mine = await this.participantsRepo.hasRow(id, user.id);
      if (!mine && !user.permissions.includes(Permission.PROJECT_VIEW_SECRET)) {
        throw DomainException.notFound('Project not found');
      }
    }
    return row;
  }
}

/** Люди из payload события состава (`project.participants_changed`). */
function changedUsersOf(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const value = (payload as { changedUserIds?: unknown }).changedUserIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
