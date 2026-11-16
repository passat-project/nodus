import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CHAT_EVENTS, type ForwardMessagesBody } from '@nodus/contracts';

import { EventBus } from '../../../core/events/event-bus.js';
import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  ConversationsRepository,
  type MemberRow,
} from '../conversations/conversations.repository.js';
import { ConversationMembersRepository } from '../conversations/conversation-members.repository.js';
import {
  PROJECT_CHAT_READER,
  type ProjectActor,
  type ProjectChatReader,
} from '../../projects/ports/project-reader.port.js';
import { can, parsePermissions } from '../permissions.js';
import { MessageDtoMapper } from './message-dto.mapper.js';
import { addMentionWatchers, mentionTokenIds, resolveMentionTargets } from './mentions.js';
import type { MessageRow } from './message-row.js';
import { MessagesRepository } from './messages.repository.js';
import { MessagesWriteRepository } from './messages-write.repository.js';
import { ThreadParticipantsRepository } from './thread-participants.repository.js';
import { VaultWriteRepository } from '../vault/vault-write.repository.js';

/**
 * Пересылка сообщений (серверные копии одним запросом, replay по
 * идемпотентному ключу). Имя класса историческое (действия над
 * сообщениями): закрепы, реакции и наблюдение трэдов выделены в
 * MessagePinsService / MessageReactionsService / ThreadWatchService (I5);
 * watch-toggle и состояния ранее перенесены сюда из MessagesService (#100).
 */
@Injectable()
export class MessageActionsService {
  constructor(
    private readonly messages: MessagesRepository,
    private readonly writes: MessagesWriteRepository,
    private readonly conversations: ConversationsRepository,
    private readonly memberships: ConversationMembersRepository,
    private readonly mapper: MessageDtoMapper,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
    private readonly threadParticipants: ThreadParticipantsRepository,
    private readonly vault: VaultWriteRepository,
    @Inject(PROJECT_CHAT_READER) private readonly projectChat: ProjectChatReader,
  ) {}

  // ===== Пересылка =====

  /**
   * Пересылка одним запросом (одна транзакция): комментарий первым, затем
   * копии в порядке messageIds; seq и createdAt монотонны в блоке (мок:
   * now+i мс — сохраняем, иначе идентичные метки ломают сортировку ленты).
   * Копии: новый id, author=пересылающий, forwardedFrom=оригинальный автор,
   * текст копируется, вложения — по ссылке (file_id), реакции/цитата — нет.
   */
  async forward(
    actor: ProjectActor,
    targetConversationId: string,
    body: ForwardMessagesBody,
    idempotencyKey: string | undefined,
  ): Promise<{ rows: MessageRow[]; members: MemberRow[] }> {
    const userId = actor.id;
    const baseKey = idempotencyKey ?? randomUUID();
    // Упоминания сопроводительного текста (#239): резолв ДО tx (как send) —
    // копии пересланных сообщений уведомлений не порождают (канон Telegram:
    // пересылка не пингает упомянутых оригинала).
    const commentMentions =
      body.comment !== undefined
        ? await resolveMentionTargets(
            this.userProfiles,
            this.conversations,
            targetConversationId,
            body.comment,
            userId,
          )
        : [];
    return this.txRunner.run(async (tx) => {
      const membership = await this.conversations.findMembership(targetConversationId, userId, tx);
      if (!membership) throw DomainException.notFound('Conversation not found');

      // Быстрый replay (как send): тот же ключ уже зафиксирован — копии и
      // побочные эффекты сделаны, отдаём их же (crash-окно между Redis-
      // реплеем и фиксацией закрывает БД, а не 500 на ON CONFLICT).
      const replayed = await this.findForwardReplay(
        userId,
        targetConversationId,
        baseKey,
        body,
        tx,
      );
      if (replayed) return replayed;

      // Членство в исходной беседе обязательно: иначе пересылка читает чужое.
      if (!(await this.conversations.findMembership(body.sourceConversationId, userId, tx))) {
        throw DomainException.notFound('Conversation not found');
      }
      const conversation = await this.conversations.findTypeAndPermissions(
        targetConversationId,
        tx,
      );
      if (!conversation) throw DomainException.notFound('Conversation not found');
      const permissions = parsePermissions(conversation.permissions);
      const threadRootId = body.threadRootId ?? null;

      if (threadRootId === null) {
        // Канал проекта (AUD-003, как send): корневые посты — руководство
        // проекта и держатели project.channel.post; матрица беседы этих ролей
        // не знает. Треды канала открыты всем участникам — без проверки.
        const allowed =
          conversation.type === 'project_channel' && conversation.projectId
            ? await this.projectChat.canPost(conversation.projectId, actor)
            : can(membership.role as 'owner' | 'admin' | 'member', permissions, 'post');
        if (!allowed) {
          throw DomainException.forbidden('Posting in this conversation requires permission');
        }
      } else {
        // Цель в треде: корень обязан быть этой беседы и корнем (мок forward).
        const root = await this.messages.findByIdInConversation(
          targetConversationId,
          threadRootId,
          tx,
        );
        if (!root || root.threadRootId !== null) {
          throw DomainException.notFound('Thread root not found');
        }
      }

      const sources = await this.messages.findForwardSources(
        body.sourceConversationId,
        body.messageIds,
        tx,
      );
      type Draft = {
        text: string;
        fwd: {
          conversationId: string;
          messageId: string;
          authorId: string;
          threadRootId: string | null;
        } | null;
        sourceId: string | null;
      };
      const drafts: Draft[] = [];
      if (body.comment !== undefined) {
        drafts.push({ text: body.comment, fwd: null, sourceId: null });
      }
      for (const source of sources) {
        drafts.push({
          text: source.text,
          fwd: {
            conversationId: source.conversationId,
            messageId: source.id,
            authorId: source.authorId,
            threadRootId: source.threadRootId,
          },
          sourceId: source.id,
        });
      }
      if (drafts.length === 0) throw DomainException.notFound('No messages to forward');

      // Тред: фиксируем «было ли до нас» до вставок (лок беседы уже сериализовал).
      let priorThreadReplies = -1;
      if (threadRootId !== null) {
        priorThreadReplies = await this.messages.countAllThreadReplies(threadRootId, tx);
      }

      const firstSeq = await this.writes.allocateSeqs(targetConversationId, drafts.length, tx);
      const createdAt = Date.now();
      const created: MessageRow[] = [];
      const vaultCopies: { message: MessageRow; text: string; sourceId?: string }[] = [];
      for (let i = 0; i < drafts.length; i += 1) {
        const draft = drafts[i]!;
        const row = await this.writes.insertMessage(
          {
            id: randomUUID(),
            conversationId: targetConversationId,
            seq: firstSeq + BigInt(i),
            authorId: userId,
            // Суффикс: все копии одного запроса делят ключ, уникальность пары.
            clientMessageId: draft.sourceId === null ? `${baseKey}:c` : `${baseKey}:${i}`,
            text: draft.text,
            replyToId: null,
            replySnapshot: null,
            urgent: false,
            // Сопроводительный текст — свои упоминания (#239); копии — без.
            mentionedUserIds: draft.fwd === null ? commentMentions : [],
            // ever = токены комментария (личные тэги + «Все»), копии — пусто.
            everMentionedUserIds:
              draft.fwd === null && body.comment !== undefined
                ? mentionTokenIds(body.comment, userId)
                : [],
            threadRootId,
            fwd: draft.fwd,
            createdAt: new Date(createdAt + i),
          },
          tx,
        );
        if (!row) {
          // Редкая гонка: конкурент с тем же ключом зафиксировался между
          // replay-проверкой и INSERT (ждал лок беседы) — реплей его блока.
          // Частичный конфликт (часть копий уже вставлена этой tx) — ключ
          // занят другим составом: откат всей пересылки.
          const raced =
            created.length === 0
              ? await this.findForwardReplay(userId, targetConversationId, baseKey, body, tx)
              : null;
          if (!raced) {
            throw DomainException.conflict('Idempotency-Key already used for another forward');
          }
          return raced;
        }
        if (draft.sourceId) {
          await this.writes.copyAttachments(draft.sourceId, row.id, tx);
        }
        vaultCopies.push({
          message: row,
          text: draft.text,
          ...(draft.sourceId ? { sourceId: draft.sourceId } : {}),
        });
        created.push(row);
      }
      // Витрина #211: копии несут текст (ссылки — в проекцию) и вложения
      // источников (Δ счётчиков) — весь механизм в репозитории витрины.
      await this.vault.applyForwardCopies(tx, targetConversationId, vaultCopies);

      if (threadRootId !== null) {
        const root = await this.messages.findByIdInConversation(
          targetConversationId,
          threadRootId,
          tx,
        );
        if (root) {
          await this.threadParticipants.upsert(threadRootId, root.authorId, 'author', tx);
        }
        await this.threadParticipants.upsert(threadRootId, userId, 'replier', tx);
        // Упомянутые в комментарии — наблюдатели трэда (#239, как отправка).
        await addMentionWatchers(
          this.threadParticipants,
          tx,
          threadRootId,
          commentMentions,
          userId,
        );
        if (priorThreadReplies === 0) {
          await this.eventBus.emit(
            tx,
            CHAT_EVENTS.THREAD_CREATED,
            { conversationId: targetConversationId, threadRootId, messageId: created[0]!.id },
            { actorId: userId, aggregateType: 'conversation', aggregateId: targetConversationId },
          );
        }
      } else {
        await this.writes.touchLastMessageAt(targetConversationId, tx);
      }
      await this.memberships.unsnooze(targetConversationId, userId, tx);
      // Пересылка — активность: раскрывает беседу скрывшим её участникам (#103).
      await this.memberships.revealHidden(targetConversationId, tx);

      const members = await this.conversations.listMembers([targetConversationId], tx);
      // Вложения копий одним батчем (для payload DTO, раунд 3).
      const copyAttachments = await this.messages.attachmentsFor(
        created.map((row) => row.id),
        tx,
      );
      const attachmentsByMessage = new Map<string, typeof copyAttachments>();
      for (const attachment of copyAttachments) {
        const list = attachmentsByMessage.get(attachment.messageId) ?? [];
        list.push(attachment);
        attachmentsByMessage.set(attachment.messageId, list);
      }
      for (const row of created) {
        // Полный DTO в payload (раунд 3): клиенты применяют локально по seq.
        // Профили — по соединению транзакции (tx): чтение мимо tx-клиента
        // занимает второе соединение пула и под бурстом взаимоблокирует
        // отправителей (repro-класс chat-reliability, замечание валидатора).
        const payloadMessage = await this.mapper.toFreshDto(row, {
          viewerId: userId,
          members,
          replyOriginal: null,
          attachments: attachmentsByMessage.get(row.id) ?? [],
          tx,
        });
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.MESSAGE_SENT,
          {
            conversationId: targetConversationId,
            messageId: row.id,
            seq: Number(row.seq),
            authorId: userId,
            threadRootId,
            forwarded: row.clientMessageId !== `${baseKey}:c`,
            mentionedUserIds: row.clientMessageId === `${baseKey}:c` ? commentMentions : [],
            message: payloadMessage,
          },
          { actorId: userId, aggregateType: 'conversation', aggregateId: targetConversationId },
        );
      }
      return { rows: created, members };
    });
  }

  /**
   * Replay пересылки по (author, client_message_id): ключи блока —
   * `${baseKey}:c` (комментарий) и `${baseKey}:${i}` (копии; i — позиция в
   * блоке, со сдвигом на комментарий). Найдено — ответ тем же составом без
   * побочных эффектов; ключ занят в ДРУГОЙ беседе — CONFLICT (как send).
   */
  private async findForwardReplay(
    userId: string,
    targetConversationId: string,
    baseKey: string,
    body: ForwardMessagesBody,
    tx: TransactionClient,
  ): Promise<{ rows: MessageRow[]; members: MemberRow[] } | null> {
    const keys = [
      `${baseKey}:c`,
      ...Array.from({ length: body.messageIds.length + 1 }, (_, i) => `${baseKey}:${i}`),
    ];
    const existing = await this.writes.findExistingByKeys(userId, keys, tx);
    if (existing.length === 0) return null;
    if (existing.some((row) => row.conversationId !== targetConversationId)) {
      throw DomainException.conflict('Idempotency-Key already used for another message');
    }
    return {
      rows: existing,
      members: await this.conversations.listMembers([targetConversationId], tx),
    };
  }
}
