import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  CHAT_EVENTS,
  ErrorCode,
  type ConversationListItem,
  type ConversationMember,
  type ListConversationMembersQuery,
  type Paginated,
} from '@nodus/contracts';

import { EventBus } from '../../../core/events/event-bus.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { CONVERSATION_ROLE_RANK } from '../permissions.js';
import { requireConversationAction } from './conversation-guards.js';
import { ConversationItemMapper } from './conversation-item.mapper.js';
import { ConversationsRepository } from './conversations.repository.js';
import { ConversationsWriteRepository } from './conversations-write.repository.js';
import { ConversationMembersRepository } from './conversation-members.repository.js';

/** Курсор страницы участников: keyset (rank, joined_at, user_id) — ранги
 *  ролей зеркалят ORDER BY listMembersPage. */
const memberCursorSchema = z.object({
  rank: z.number().int().min(0).max(2),
  joinedAt: z.string(),
  userId: z.string().uuid(),
});

/** Сортировочные ранги ролей для СПИСКА (владелец первым); иерархия прав —
 *  CONVERSATION_ROLE_RANK (обратный порядок: owner=2 — старше всех). */
const SORT_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/** Лимит участников беседы (README модуля: ≤200). */
export const MAX_MEMBERS = 200;

/**
 * Участники беседы (#186): список с ролями и поиском, добавление (право
 * addMembers — дефолт «любой участник»), смена роли модератора (право
 * manageSettings — владелец), исключение (право removeMembers + иерархия:
 * актёр строго старше цели). Мутации состава — только группы и каналы:
 * состав direct/task/letter фиксирован сущностью (#195). Права — гвардом
 * по матрице беседы (I8); не-члену беседа не видна (404).
 */
@Injectable()
export class ConversationMembersService {
  constructor(
    private readonly repo: ConversationsRepository,
    private readonly writes: ConversationsWriteRepository,
    private readonly memberships: ConversationMembersRepository,
    private readonly items: ConversationItemMapper,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
  ) {}

  /** Список участников с ролями: только член беседы; поиск — по отображаемому
   *  имени через read-порт справочника (I3), сортировка — владелец, модераторы,
   *  участники (внутри яруса — по времени входа), keyset-пагинация. */
  async list(
    userId: string,
    conversationId: string,
    query: ListConversationMembersQuery,
  ): Promise<Paginated<ConversationMember>> {
    if (!(await this.repo.findMembership(conversationId, userId))) {
      throw DomainException.notFound('Conversation not found');
    }
    let searchUserIds: string[] | undefined;
    if (query.search) {
      searchUserIds = (await this.userProfiles.searchByDisplayName(query.search, MAX_MEMBERS)).map(
        (ref) => ref.id,
      );
    }
    const cursor = query.cursor ? decodeCursor(query.cursor, memberCursorSchema) : undefined;
    const rows = await this.repo.listMembersPage(conversationId, {
      limit: query.limit,
      cursor,
      searchUserIds,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await this.toMembers(page);
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              rank: SORT_RANK[last.role] ?? 2,
              joinedAt: last.joinedAt.toISOString(),
              userId: last.userId,
            })
          : null,
    };
  }

  /**
   * Добавление участников: право addMembers (дефолт — любой участник);
   * только группы/каналы — состав direct/task/letter фиксирован сущностью
   * (#195). Канал, привязанный к проекту, составом ведёт проект (гвард
   * отсекает по projectId, AUD-003); канал БЕЗ проекта («Новости компании»)
   * добавляет по матрице прав «Добавление участников». Неизвестных справочнику
   * и уже состоящих пропускаем молча; превышение лимита 200 — ошибка валидации.
   * Событие member_added (существует) — gateway доставляет и добавленным.
   */
  async add(
    userId: string,
    conversationId: string,
    body: { userIds: string[] },
  ): Promise<ConversationListItem> {
    await requireConversationAction(this.repo, conversationId, userId, 'addMembers', [
      'group',
      'project_channel',
    ]);
    // Только действующие сотрудники (#343): уволенного в беседу не добавить.
    const known = new Set(await this.userProfiles.filterActiveUserIds([...new Set(body.userIds)]));
    const existing = new Set((await this.repo.listMembers([conversationId])).map((m) => m.userId));
    const toAdd = [...new Set(body.userIds)].filter((id) => known.has(id) && !existing.has(id));
    if (toAdd.length > 0) {
      await this.txRunner.run(async (tx) => {
        // Лимит точный: блокировка строки беседы сериализует одновременные
        // add — перечёт под локом не может проскочить 200 (TOCTOU, #195).
        await this.writes.lockConversation(conversationId, tx);
        if ((await this.repo.countMembers(conversationId, tx)) + toAdd.length > MAX_MEMBERS) {
          throw new DomainException(
            ErrorCode.CHAT_MEMBERS_LIMIT_REACHED,
            'Conversation member limit reached',
            {
              max: MAX_MEMBERS,
            },
          );
        }
        const added = await this.memberships.addMembers(conversationId, toAdd, tx);
        if (added.length > 0) {
          await this.eventBus.emit(
            tx,
            CHAT_EVENTS.MEMBER_ADDED,
            { conversationId, userIds: added, role: 'member' },
            { actorId: userId, aggregateType: 'conversation', aggregateId: conversationId },
          );
        }
      });
    }
    return this.getItemOrThrow(conversationId, userId);
  }

  /**
   * Смена роли (модератор ⇄ участник): право manageSettings (дефолт —
   * владелец); только группы и каналы — у direct/task/letter ролей нет
   * (#195); роль владельца не меняется никем (владелец один — создатель).
   */
  async updateRole(
    userId: string,
    conversationId: string,
    memberUserId: string,
    body: { role: 'admin' | 'member' },
  ): Promise<ConversationMember> {
    await requireConversationAction(this.repo, conversationId, userId, 'manageSettings', [
      'group',
      'project_channel',
    ]);
    const target = await this.repo.findMembership(conversationId, memberUserId);
    if (!target) throw DomainException.notFound('Member not found');
    if (target.role === 'owner') {
      throw DomainException.forbidden('Owner role cannot be changed');
    }
    if (target.role !== body.role) {
      await this.txRunner.run(async (tx) => {
        await this.memberships.updateMemberRole(conversationId, memberUserId, body.role, tx);
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.MEMBER_ROLE_CHANGED,
          { conversationId, userId: memberUserId, role: body.role, actorId: userId },
          { actorId: userId, aggregateType: 'conversation', aggregateId: conversationId },
        );
      });
    }
    const updated = await this.toMembers([
      { userId: memberUserId, role: body.role, joinedAt: target.joinedAt },
    ]);
    if (!updated[0]) throw DomainException.notFound('Member not found');
    return updated[0];
  }

  /**
   * Исключение участника: право removeMembers (дефолт — владелец и модераторы)
   * + иерархия — актёр строго старше цели (модератора снимает только
   * владелец); только группы/каналы (#195). Канал с проектом составом ведёт
   * проект (гвард отсекает по projectId, AUD-003); канал без проекта исключает
   * по матрице прав. Владельца исключить нельзя. Вместе со строкой участия
   * уходит черновик исключённого (user-FK нет — чистим явно).
   */
  async remove(userId: string, conversationId: string, memberUserId: string): Promise<void> {
    await requireConversationAction(this.repo, conversationId, userId, 'removeMembers', [
      'group',
      'project_channel',
    ]);
    const target = await this.repo.findMembership(conversationId, memberUserId);
    if (!target) throw DomainException.notFound('Member not found');
    if (target.role === 'owner') {
      throw DomainException.forbidden('Owner cannot be removed');
    }
    const actor = await this.repo.findMembership(conversationId, userId);
    if (
      actor &&
      (CONVERSATION_ROLE_RANK[actor.role as keyof typeof CONVERSATION_ROLE_RANK] ?? 0) <=
        (CONVERSATION_ROLE_RANK[target.role as keyof typeof CONVERSATION_ROLE_RANK] ?? 0)
    ) {
      throw DomainException.forbidden('Actor rank must exceed target rank');
    }
    await this.txRunner.run(async (tx) => {
      if (!(await this.memberships.removeMember(conversationId, memberUserId, tx))) {
        throw DomainException.notFound('Member not found');
      }
      await this.eventBus.emit(
        tx,
        CHAT_EVENTS.MEMBER_REMOVED,
        { conversationId, userId: memberUserId, actorId: userId },
        { actorId: userId, aggregateType: 'conversation', aggregateId: conversationId },
      );
    });
  }

  private async getItemOrThrow(
    conversationId: string,
    userId: string,
  ): Promise<ConversationListItem> {
    const row = await this.repo.findListItem(conversationId, userId);
    if (!row) throw DomainException.notFound('Conversation not found');
    const members = await this.repo.listMembers([conversationId]);
    return this.items.toItem(row, { viewerId: userId, members });
  }

  /** Строки участия → DTO участников (профили — read-порт справочника). */
  private async toMembers(
    rows: Array<{ userId: string; role: string; joinedAt: Date }>,
  ): Promise<ConversationMember[]> {
    if (rows.length === 0) return [];
    const refs = new Map(
      (await this.userProfiles.findRefs(rows.map((r) => r.userId))).map((r) => [r.id, r]),
    );
    return rows.flatMap((row) => {
      const user = refs.get(row.userId);
      return user
        ? [
            {
              user,
              role: row.role as ConversationMember['role'],
              joinedAt: row.joinedAt.toISOString(),
            },
          ]
        : [];
    });
  }
}
