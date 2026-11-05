import { Inject, Injectable } from '@nestjs/common';
import { CHAT_EVENTS } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { TASK_CHAT_READER, type TaskChatReader } from '../../tasks/ports/task-chat-reader.port.js';
import { TaskChatRepository } from './task-chat.repository.js';

/**
 * Чат задачи = беседа мессенджера `type='task'` (канон владельца #252: «у
 * нас не должно поддерживаться 2 или более чатов»). Состав = участники
 * задачи (read-порт TASK_CHAT_READER): постановщик — owner, остальные —
 * member; новый наблюдатель — без звука (Битрикс24). Синхронизация
 * идемпотентна и вызывается обработчиками task.* и GET by-task (беседа
 * старой задачи создаётся при первом открытии).
 */
@Injectable()
export class TaskChatService {
  constructor(
    private readonly repo: TaskChatRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(TASK_CHAT_READER) private readonly tasks: TaskChatReader,
  ) {}

  /** Привести беседу задачи к составу задачи; null — задачи нет (удалена):
   *  состав беседы распускается — чат удалённой задачи пропадает из вкладки
   *  «Чаты задач и писем» у всех (история остаётся в БД). Состав читается
   *  ПОСЛЕ блокировки беседы (security-гейт #252): иначе sync со старым
   *  составом, дождавшись блокировки, вернул бы выбывшего участника. */
  async sync(taskId: string, actorId: string | null): Promise<string | null> {
    return this.txRunner.run(async (tx) => {
      let id = await this.repo.find(tx, taskId);
      let created = false;
      if (!id) {
        const pre = await this.tasks.roster(taskId);
        if (!pre) return null;
        ({ id, created } = await this.repo.findOrCreate(tx, taskId, pre.creatorId));
      }
      await this.repo.lock(tx, id);
      const current = await this.repo.members(tx, id);
      const roster = await this.tasks.roster(taskId);
      if (!roster) {
        await this.removeMembers(tx, id, current, actorId);
        return null;
      }
      const currentSet = new Set(current);
      const desired = new Set(roster.members.map((m) => m.userId));
      const added = await this.repo.addMembers(
        tx,
        id,
        roster.members
          .filter((m) => !currentSet.has(m.userId))
          .map((m) => ({
            userId: m.userId,
            role: m.userId === roster.creatorId ? 'owner' : 'member',
            muted: m.muted,
          })),
      );
      const meta = { actorId, aggregateType: 'conversation', aggregateId: id };
      if (created) {
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.CONVERSATION_CREATED,
          {
            conversationId: id,
            type: 'task',
            title: null,
            createdBy: roster.creatorId,
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

  /** Название задачи изменилось: строки списка бесед у участников
   *  перечитываются (ссылка на задачу — read-порт, хранить нечего). */
  async touch(taskId: string, actorId: string | null): Promise<void> {
    await this.txRunner.run(async (tx) => {
      const id = await this.repo.find(tx, taskId);
      if (!id) return;
      await this.eventBus.emit(
        tx,
        CHAT_EVENTS.CONVERSATION_UPDATED,
        { conversationId: id, taskChanged: true },
        { actorId, aggregateType: 'conversation', aggregateId: id },
      );
    });
  }

  /** Беседа задачи для карточки: задача видна И пользователь — её участник
   *  ЛИБО решающий текущего шага (#433): решающему чат открывается read-only
   *  (sync не добавляет его в состав, писать он не сможет). Руководитель по
   *  оргструктуре и `task.view_all` видят задачу, но обсуждение не читают —
   *  404 тем же текстом (без оракула). */
  async openForUser(
    taskId: string,
    user: { id: string; permissions: readonly string[] },
  ): Promise<string> {
    const roster = (await this.tasks.canView(taskId, user))
      ? await this.tasks.roster(taskId)
      : null;
    if (!roster) throw DomainException.notFound('Task not found');
    const isMember = roster.members.some((member) => member.userId === user.id);
    const allowed = isMember || (await this.tasks.isDecider(taskId, user.id));
    const id = allowed ? await this.sync(taskId, user.id) : null;
    if (!id) throw DomainException.notFound('Task not found');
    return id;
  }
}
