import { Inject, Injectable } from '@nestjs/common';
import { CHAT_EVENTS } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  LETTER_CHAT_READER,
  type LetterChatReader,
} from '../../correspondence/ports/letter-chat-reader.port.js';
import { LetterChatRepository } from './letter-chat.repository.js';

/**
 * Чат письма = беседа мессенджера `type='letter'` (#55, Р10; канон «один чат
 * на сущность»). Состав = адресат (owner) + участники (`member`); регистратор
 * в чат не входит (В2). Синхронизация идемпотентна и вызывается событиями
 * `correspondence.*` и GET by-letter (беседа старого письма создаётся при
 * первом открытии). До регистрации беседа есть, только если обсуждение
 * начато (участники есть, владелец — создатель, редизайн #56); состав
 * переживает регистрацию — владелец становится адресатом.
 */
@Injectable()
export class LetterChatService {
  constructor(
    private readonly repo: LetterChatRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(LETTER_CHAT_READER) private readonly letters: LetterChatReader,
  ) {}

  /** Привести беседу к составу письма; null — письма нет либо беседы не
   *  существует (незарегистрированное без участников — состав распускается,
   *  история остаётся). Первое чтение состава — ДО транзакции (AUD-022: порт
   *  без tx занял бы второе соединение пула внутри транзакции); повторное
   *  чтение под блокировкой беседы — гейт #252, как у задач. */
  async sync(letterId: string, actorId: string | null): Promise<string | null> {
    const preRoster = await this.letters.roster(letterId);
    return this.txRunner.run(async (tx) => {
      let id = await this.repo.find(tx, letterId);
      let created = false;
      if (!id) {
        if (!preRoster) return null;
        ({ id, created } = await this.repo.findOrCreate(tx, letterId, preRoster.ownerId));
      }
      await this.repo.lock(tx, id);
      const current = await this.repo.members(tx, id);
      // Порт не принимает tx: чтение идёт своим соединением внутри tx —
      // известное исключение AUD-022 (зафиксировано в отчёте).
      const roster = await this.letters.roster(letterId);
      if (!roster) {
        await this.removeMembers(tx, id, current, actorId);
        return null;
      }
      const currentSet = new Set(current);
      const desired = new Set([roster.ownerId, ...roster.members.map((member) => member.userId)]);
      const added = await this.repo.addMembers(
        tx,
        id,
        [...desired]
          .filter((userId) => !currentSet.has(userId))
          .map((userId) => ({
            userId,
            role: userId === roster.ownerId ? 'owner' : 'member',
            muted: roster.members.find((member) => member.userId === userId)?.muted ?? false,
          })),
      );
      const meta = { actorId, aggregateType: 'conversation', aggregateId: id };
      if (created) {
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.CONVERSATION_CREATED,
          {
            conversationId: id,
            type: 'letter',
            title: null,
            createdBy: roster.ownerId,
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

  /** Тема письма изменилась — строки списка бесед перечитываются. */
  async touch(letterId: string, actorId: string | null): Promise<void> {
    await this.txRunner.run(async (tx) => {
      const id = await this.repo.find(tx, letterId);
      if (!id) return;
      await this.eventBus.emit(
        tx,
        CHAT_EVENTS.CONVERSATION_UPDATED,
        { conversationId: id, letterChanged: true },
        { actorId, aggregateType: 'conversation', aggregateId: id },
      );
    });
  }

  /** Беседа письма для карточки: письмо видно И пользователь — участник
   *  (адресат или присоединившийся). Остальным — 404 без оракула. */
  async openForUser(
    letterId: string,
    user: { id: string; permissions: readonly string[] },
  ): Promise<string> {
    const roster = (await this.letters.canView(letterId, user))
      ? await this.letters.roster(letterId)
      : null;
    const member =
      roster !== null &&
      (roster.ownerId === user.id || roster.members.some((item) => item.userId === user.id));
    const id = member ? await this.sync(letterId, user.id) : null;
    if (!id) throw DomainException.notFound('Letter not found');
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
}
