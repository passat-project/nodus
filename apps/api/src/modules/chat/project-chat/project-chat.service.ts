import { Inject, Injectable } from '@nestjs/common';
import { CHAT_EVENTS, type DomainEvent } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  PROJECT_CHAT_READER,
  type ProjectChatReader,
} from '../../projects/ports/project-reader.port.js';
import { ProjectChatRepository } from './project-chat.repository.js';

/**
 * Канал проекта (#52, Р8; вердикт 29.10): беседа `type='project_channel'`
 * visibility closed — вступление только через участие в проекте (обход
 * «открытыми каналами» закрыт). Состав = участники всех источников (roster
 * read-порта), руководитель — owner. Пишут руководитель, помощники и
 * держатели `project.channel.post` (канал-объявление, паттерн Slack);
 * треды открыты всем участникам. Синхронизация идемпотентна: обработчики
 * project.* и GET by-project (канал проекта без событий создаётся при
 * первом открытии участником).
 */
@Injectable()
export class ProjectChatService {
  constructor(
    private readonly repo: ProjectChatRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(PROJECT_CHAT_READER) private readonly projects: ProjectChatReader,
  ) {}

  /** Привести канал к составу участников проекта; null — проекта нет. Состав
   *  и название читаются ДО транзакции (AUD-022: порты без tx заняли бы
   *  второе соединение пула внутри транзакции). Порт состава не принимает
   *  tx, поэтому повторного чтения под блокировкой нет — известное исключение
   *  AUD-022 (зафиксировано в отчёте). */
  async sync(projectId: string, actorId: string | null): Promise<string | null> {
    const roster = await this.projects.roster(projectId);
    if (!roster) return null;
    const title = await this.titleOf(projectId);
    return this.txRunner.run(async (tx) => {
      let id = await this.repo.find(tx, projectId);
      let created = false;
      if (!id) {
        ({ id, created } = await this.repo.findOrCreate(tx, projectId, title, roster.managerId));
      }
      await this.repo.lock(tx, id);
      const current = await this.repo.members(tx, id);
      const currentSet = new Set(current);
      const desired = new Set([roster.managerId, ...roster.memberIds]);
      // Роль owner — ТОЛЬКО действующий руководитель: после передачи
      // руководства прежний РП становится member (иначе сохраняет
      // manageSettings/removeMembers канала).
      const roleChanges = (await this.repo.roles(tx, id))
        .filter(
          (row) =>
            desired.has(row.userId) &&
            row.role !== (row.userId === roster.managerId ? 'owner' : 'member'),
        )
        .map((row) => ({
          userId: row.userId,
          role: row.userId === roster.managerId ? 'owner' : 'member',
        }));
      if (roleChanges.length > 0) await this.repo.updateRoles(tx, id, roleChanges);
      const added = await this.repo.addMembers(
        tx,
        id,
        [...desired]
          .filter((userId) => !currentSet.has(userId))
          .map((userId) => ({
            userId,
            role: userId === roster.managerId ? 'owner' : 'member',
          })),
      );
      const meta = { actorId, aggregateType: 'conversation', aggregateId: id };
      if (created) {
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.CONVERSATION_CREATED,
          {
            conversationId: id,
            type: 'project_channel',
            title,
            createdBy: roster.managerId,
            memberIds: added,
          },
          meta,
        );
      } else if (added.length > 0) {
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.MEMBER_ADDED,
          { conversationId: id, userIds: added, role: 'member' },
          meta,
        );
      }
      await this.removeMembers(
        tx,
        id,
        current.filter((userId) => !desired.has(userId)),
        actorId,
      );
      return id;
    });
  }

  /** Переименование проекта: заголовок канала «Проект: <имя>». */
  async renamed(projectId: string, name: string, actorId: string | null): Promise<void> {
    await this.txRunner.run(async (tx) => {
      const id = await this.repo.find(tx, projectId);
      if (!id) return;
      await this.repo.rename(tx, id, `Проект: ${name}`);
      await this.eventBus.emit(
        tx,
        CHAT_EVENTS.CONVERSATION_UPDATED,
        { conversationId: id, title: `Проект: ${name}` },
        { actorId, aggregateType: 'conversation', aggregateId: id },
      );
    });
  }

  /** Канал для карточки проекта: проект виден И пользователь — участник.
   *  Не-участник открытого проекта канал не открывает (вердикт Т1:
   *  «к каналу присоединиться нельзя — вступи в проект»), 404 без оракула. */
  async openForUser(
    projectId: string,
    user: { id: string; permissions: readonly string[] },
  ): Promise<string> {
    const roster = (await this.projects.canView(projectId, user))
      ? await this.projects.roster(projectId)
      : null;
    const id =
      roster && (roster.memberIds.includes(user.id) || roster.managerId === user.id)
        ? await this.sync(projectId, user.id)
        : null;
    if (!id) throw DomainException.notFound('Project not found');
    return id;
  }

  private async removeMembers(
    tx: TransactionClient,
    conversationId: string,
    userIds: string[],
    actorId: string | null,
  ): Promise<void> {
    await this.repo.removeMembers(tx, conversationId, userIds);
    for (const userId of userIds) {
      await this.eventBus.emit(
        tx,
        CHAT_EVENTS.MEMBER_REMOVED,
        { conversationId, userId, actorId },
        { actorId, aggregateType: 'conversation', aggregateId: conversationId },
      );
    }
  }

  private async titleOf(projectId: string): Promise<string> {
    const [ref] = await this.projects.refs([projectId]);
    return `Проект: ${ref?.name ?? projectId}`;
  }
}

/** Событие project.* → sync/переименование канала (гейт флагом chat). */
@Injectable()
export class ProjectChatHandlers {
  constructor(
    private readonly chat: ProjectChatService,
    private readonly flags: FeatureFlagService,
  ) {}

  async created(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    if (!(await this.flags.isEnabled('chat'))) return;
    const { projectId } = event.payload as { projectId?: string };
    if (typeof projectId === 'string') await this.chat.sync(projectId, event.actorId);
  }

  async participantsChanged(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    if (!(await this.flags.isEnabled('chat'))) return;
    const { projectId } = event.payload as { projectId?: string };
    if (typeof projectId === 'string') await this.chat.sync(projectId, event.actorId);
  }

  async updated(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    if (!(await this.flags.isEnabled('chat'))) return;
    const { projectId, name } = event.payload as { projectId?: string; name?: string };
    if (typeof projectId !== 'string') return;
    if (typeof name === 'string') await this.chat.renamed(projectId, name, event.actorId);
    await this.chat.sync(projectId, event.actorId);
  }
}
