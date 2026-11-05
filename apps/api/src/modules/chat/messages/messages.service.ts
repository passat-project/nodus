import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CHAT_EVENTS,
  MENTION_ALL_ID,
  type ChatMessage,
  type EditMessageBody,
  type ListMessagesQuery,
  type Paginated,
  type ReadConversationResult,
  type SendMessageBody,
} from '@nodus/contracts';

import { EventBus } from '../../../core/events/event-bus.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import {
  ConversationsRepository,
  type MemberRow,
} from '../conversations/conversations.repository.js';
import { ConversationMembersRepository } from '../conversations/conversation-members.repository.js';
import { ConversationDraftsRepository } from '../conversations/conversation-drafts.repository.js';
import { can, parsePermissions } from '../permissions.js';
import {
  PROJECT_CHAT_READER,
  type ProjectChatReader,
} from '../../projects/ports/project-reader.port.js';
import { TASK_CHAT_READER, type TaskChatReader } from '../../tasks/ports/task-chat-reader.port.js';
import {
  MessageDtoMapper,
  readEverMentionedUserIds,
  readMentionedUserIds,
} from './message-dto.mapper.js';
import { addMentionWatchers, mentionTokenIds, resolveMentionTargets } from './mentions.js';
import { assertUrgentSendAllowedBy } from './send-urgent.policy.js';
import type { ClaimedAttachmentRow, MessageRow } from './message-row.js';
import { MessagesRepository } from './messages.repository.js';
import { MessagesWriteRepository } from './messages-write.repository.js';
import { MessagesLifecycleRepository } from './messages-lifecycle.repository.js';
import { MessagesReadStateRepository } from './messages-read-state.repository.js';
import {
  applyThreadReplyEffects,
  loadReplyQuote,
  resolveSendSticker,
} from './messages-send-prepare.js';
import { AttachmentsRepository } from './attachments.repository.js';
import { ThumbnailQueue } from './thumbnail.queue.js';
import { warmMissingPreviews } from './preview-warmup.js';
import { ThreadParticipantsRepository } from './thread-participants.repository.js';
import { VaultWriteRepository } from '../vault/vault-write.repository.js';
import { syncEditAttachments } from './messages-edit-attachments.js';
import { StickersRepository, type StickerAttachmentRow } from '../stickers/stickers.repository.js';

const messageCursorSchema = z.object({ s: z.number().int().positive() });

export interface SendResult {
  message: MessageRow;
  members: MemberRow[];
  replayed: boolean;
}

// >300 строк — обоснование (I5): транзакция отправки (идемпотентность+seq+вложения+побочные+события)
// неразрывна; правка/удаление разделяют те же инварианты правила следа — единый сервис агрегата.
// Подготовка/эффекты отправки — messages-send-prepare.ts, удаление — messages-delete.service.ts.
/**
 * Ядро сообщений: отправка (seq + идемпотентность в БД + outbox в одной
 * транзакции), лента/треды курсором по seq, квитанции просмотров (POST
 * /read — watermark GREATEST), правка/удаление по правилу следа. Все
 * мутации сообщений начинаются с UPDATE conversations SET last_seq →
 * транзакции беседы сериализуются.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly repo: MessagesRepository,
    private readonly writes: MessagesWriteRepository,
    private readonly lifecycle: MessagesLifecycleRepository,
    private readonly readState: MessagesReadStateRepository,
    private readonly attachmentsRepo: AttachmentsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly memberships: ConversationMembersRepository,
    private readonly drafts: ConversationDraftsRepository,
    private readonly mapper: MessageDtoMapper,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
    private readonly threadParticipants: ThreadParticipantsRepository,
    private readonly stickersRepo: StickersRepository,
    private readonly vault: VaultWriteRepository,
    private readonly thumbnailQueue: ThumbnailQueue,
    @Inject(PROJECT_CHAT_READER) private readonly projectChat: ProjectChatReader,
    // #433: необязателен для юнит-тестов сообщений; в приложении ChatModule
    // импортирует TasksPortsModule и токен есть.
    @Optional() @Inject(TASK_CHAT_READER) private readonly taskChat?: TaskChatReader,
  ) {}

  // ===== Чтение =====

  /** Страница ленты/треда (ASC в странице, курсор назад по seq). Курсор
   *  прочтения НЕ двигает (#102 раунд 2): просмотр = видимость в вьюпорте,
   *  квитанции — POST /read от клиента. */
  async list(
    userId: string,
    conversationId: string,
    query: ListMessagesQuery,
  ): Promise<Paginated<ChatMessage>> {
    const membership = await this.conversations.findMembership(conversationId, userId);
    if (!membership) {
      // Читатель-решающий (#433) видит ленту, но не становится участником.
      const taskId = await this.conversations.findTaskId(conversationId);
      if (!taskId || !this.taskChat || !(await this.taskChat.isDecider(taskId, userId))) {
        throw DomainException.notFound('Conversation not found');
      }
    }
    const beforeSeq = query.cursor
      ? BigInt(decodeCursor(query.cursor, messageCursorSchema).s)
      : null;
    const { rows, hasMore } = await this.repo.listPage(conversationId, {
      limit: query.limit,
      beforeSeq,
      threadRootId: query.threadRootId ?? null,
    });
    const members = await this.conversations.listMembers([conversationId]);
    const items = await this.mapper.toDtos(rows, { viewerId: userId, members });
    warmMissingPreviews(items, this.thumbnailQueue);
    // Курсор — по самому старому ОТВЕТУ страницы: на первой странице треда
    // корень вставлен первым, а его seq меньше всех ответов — курсор по нему
    // дал бы пустую вторую страницу при hasMore=true.
    const oldest = query.threadRootId ? rows.find((row) => row.id !== query.threadRootId) : rows[0];
    return {
      items,
      nextCursor: hasMore && oldest ? encodeCursor({ s: Number(oldest.seq) }) : null,
    };
  }

  /**
   * Квитанция просмотров (#102 раунд 2): клиент видел до upToSeq (клампится к
   * last_seq беседы — фантомное «всё прочитано» с кривым клиентом невозможно).
   * Watermark двигается GREATEST-ом в своей транзакции; событие — только при
   * реальном изменении (дубликаты/повторы тихи). readAt — фактическое время
   * из строки, не момент эмита.
   *
   * threadRootId (раунд 3) — квитанция ИЗ ТРЕДА: сверх watermark беседы
   * («увидел где угодно = просмотрено») двигает watermark трэда НАБЛЮДАТЕЛЯ
   * (точка «есть новые» на посте гаснет); не-наблюдателю писать нечего.
   */
  async readConversation(
    userId: string,
    conversationId: string,
    upToSeq: number,
    threadRootId?: string,
  ): Promise<ReadConversationResult> {
    return this.txRunner.run(async (tx) => {
      const membership = await this.conversations.findMembership(conversationId, userId, tx);
      if (!membership) throw DomainException.notFound('Conversation not found');
      const lastSeq = await this.conversations.findLastSeq(conversationId, tx);
      if (lastSeq === null) throw DomainException.notFound('Conversation not found');
      const target = lastSeq < BigInt(upToSeq) ? lastSeq : BigInt(upToSeq);
      if (threadRootId !== undefined) {
        const root = await this.repo.findByIdInConversation(conversationId, threadRootId, tx);
        if (!root || root.threadRootId !== null) {
          throw DomainException.notFound('Thread root not found');
        }
      }
      const { advanced, lastReadAt } = await this.readState.advanceReadCursor(
        conversationId,
        userId,
        target,
        tx,
      );
      if (threadRootId !== undefined) {
        // Тихо: событие беседы ниже уже инвалидирует thread-state клиентам.
        await this.threadParticipants.advanceReadCursor(threadRootId, userId, target, tx);
      }
      if (advanced) {
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.MESSAGE_READ,
          {
            conversationId,
            userId,
            upToSeq: Number(target),
            readAt: (lastReadAt ?? new Date()).toISOString(),
          },
          { actorId: userId, aggregateType: 'conversation', aggregateId: conversationId },
        );
      }
      return { upToSeq: Number(target) };
    });
  }

  // ===== Поиск по id (окно перехода, #380) =====

  /** Живые сообщения беседы по id: только участник (иначе 404 — без оракула);
   *  отсутствующие/удалённые молча выпадают. Нужно окну перехода, чтобы
   *  показать файлы/сообщения итога вне загруженной ленты. */
  async lookup(
    userId: string,
    conversationId: string,
    messageIds: readonly string[],
  ): Promise<{ messages: MessageRow[]; members: MemberRow[] }> {
    return this.txRunner.run(async (tx) => {
      const membership = await this.conversations.findMembership(conversationId, userId, tx);
      if (!membership) throw DomainException.notFound('Conversation not found');
      return {
        messages: await this.repo.findLiveByIdsInConversation(conversationId, messageIds, tx),
        members: await this.conversations.listMembers([conversationId], tx),
      };
    });
  }

  // ===== Отправка =====

  /**
   * Отправка: транзакция [replay-проверка → валидации → seq → INSERT ON
   * CONFLICT → вложения → гашение черновика/снуза → события]. Идемпотентность
   * двойная: Redis-интерсептор (ADR-0005) на повторе запроса и уникальная
   * пара (author, client_message_id) в БД на crash-окно между реплеем и
   * фиксацией. client_message_id = Idempotency-Key запроса.
   */
  async send(
    actor: { id: string; permissions: readonly string[] },
    conversationId: string,
    body: SendMessageBody,
    idempotencyKey: string | undefined,
  ): Promise<SendResult> {
    const userId = actor.id;
    const clientMessageId = idempotencyKey ?? randomUUID();
    // @упоминания (#176): токены → активные участники беседы, ДО tx (repro
    // chat-reliability: второе соединение пула внутри tx голодает его).
    const mentionMatches = await this.resolveMentions(conversationId, body.text, userId);
    return this.txRunner.run(async (tx) => {
      const membership = await this.conversations.findMembership(conversationId, userId, tx);
      if (!membership) throw DomainException.notFound('Conversation not found');

      // Быстрый replay: тот же ключ уже зафиксирован — побочные эффекты сделаны.
      const existing = await this.writes.findExisting(userId, clientMessageId, tx);
      if (existing) {
        if (existing.conversationId !== conversationId) {
          throw DomainException.conflict('Idempotency-Key already used for another message');
        }
        return {
          message: existing,
          members: await this.conversations.listMembers([conversationId], tx),
          replayed: true,
        };
      }

      const conversation = await this.conversations.findTypeAndPermissions(conversationId, tx);
      if (!conversation) throw DomainException.notFound('Conversation not found');
      const permissions = parsePermissions(conversation.permissions);
      const threadRootId = body.threadRootId ?? null;

      // «Важное сообщение» (#100): лимит отправителя и потолок участников —
      // на бэкенде (I8); политика — чистая функция send-urgent.policy.ts.
      const urgent = body.urgent ?? false;
      if (urgent) {
        // Лок лимита автора ДО подсчёта (#177): гонка параллельных отправок
        // на границе лимита закрыта (паттерн advisory/FOR UPDATE #195).
        await this.writes.lockUrgentLimit(userId, tx);
        await assertUrgentSendAllowedBy({
          conversationType: conversation.type,
          countMembers: () => this.conversations.countMembers(conversationId, tx),
          countUrgentSent: () =>
            this.writes.countUrgentSentSince(userId, new Date(Date.now() - 24 * 3600 * 1000), tx),
        });
      }

      // Право постить — только на корневые сообщения ленты; треды открыты
      // всем участникам (модель канала новостей: постят избранные, обсуждают все).
      // Канал проекта (#52 Р8): корневые посты — руководство проекта и
      // держатели project.channel.post (матрица беседы не знает этих ролей).
      if (threadRootId === null) {
        const allowed =
          conversation.type === 'project_channel' && conversation.projectId
            ? await this.projectChat.canPost(conversation.projectId, actor)
            : can(membership.role as 'owner' | 'admin' | 'member', permissions, 'post');
        if (!allowed) {
          throw DomainException.forbidden('Posting in this conversation requires permission');
        }
      }

      // Валидация треда: ровно один уровень, корень — этой беседы.
      let threadRoot: MessageRow | null = null;
      if (threadRootId !== null) {
        threadRoot = await this.repo.findByIdInConversation(conversationId, threadRootId, tx);
        if (!threadRoot || threadRoot.threadRootId !== null) {
          throw DomainException.notFound('Thread root not found');
        }
      }

      // Стикер (#143) и снапшот цитаты — messages-send-prepare.ts (I5).
      const stickerHit = await resolveSendSticker(this.stickersRepo, body, userId, tx);
      const { replySnapshot, replyOriginalRow } = await loadReplyQuote(
        this.repo,
        conversationId,
        body,
        tx,
      );

      const seq = await this.writes.allocateSeqs(conversationId, 1, tx);
      const inserted = await this.writes.insertMessage(
        {
          id: randomUUID(),
          conversationId,
          seq,
          authorId: userId,
          clientMessageId,
          text: body.text,
          replyToId: body.replyToId ?? null,
          replySnapshot,
          threadRootId,
          fwd: null,
          urgent,
          mentionedUserIds: mentionMatches,
          everMentionedUserIds: mentionTokenIds(body.text, userId),
          createdAt: new Date(),
        },
        tx,
      );
      if (!inserted) {
        // Редкая гонка: фиксация конкурента между SELECT и INSERT — реплей.
        const raced = await this.writes.findExisting(userId, clientMessageId, tx);
        if (!raced) throw new Error('send: ON CONFLICT returned nothing and no existing row');
        return {
          message: raced,
          members: await this.conversations.listMembers([conversationId], tx),
          replayed: true,
        };
      }

      // Вложения: стикер — прямая вставка со снапшотом пака (#143), обычные —
      // одноразовый claim трея. Активность беседы — только корневые.
      const claimedAttachments: (ClaimedAttachmentRow | StickerAttachmentRow)[] = stickerHit
        ? [
            await this.stickersRepo.insertAttachmentForMessage(
              inserted.id,
              userId,
              stickerHit,
              stickerHit.pack,
              tx,
            ),
          ]
        : await this.writes.claimAttachments(inserted.id, body.attachmentIds ?? [], userId, tx);
      // Витрина #211: проекция ссылок + Δ денормализованных счётчиков (та же
      // tx; стикеры видом 'sticker' в счётчиках не участвуют).
      await this.vault.applyMessageSent(tx, inserted, claimedAttachments, body.text);
      // Стикер не гасит черновик композера (keepDraft, #143): набранный текст
      // остаётся жить в PUT /draft после отправки стикера.
      if (stickerHit === null) {
        await this.drafts.clearDraft(conversationId, userId, tx);
      }
      await this.memberships.unsnooze(conversationId, userId, tx);
      // Активность раскрывает беседу скрывшим её участникам (#103).
      await this.memberships.revealHidden(conversationId, tx);
      if (threadRootId === null) {
        await this.writes.touchLastMessageAt(conversationId, tx);
      } else {
        await applyThreadReplyEffects(
          { repo: this.repo, threadParticipants: this.threadParticipants, eventBus: this.eventBus },
          { userId, conversationId, threadRootId, threadRoot, inserted },
          tx,
        );
      }
      // @упоминания (раунд 3): упомянутые — наблюдатели трэда этого сообщения
      // (для корневого — его будущего треда); соответствие решено до tx.
      await addMentionWatchers(
        this.threadParticipants,
        tx,
        threadRootId ?? inserted.id,
        mentionMatches,
        userId,
      );

      const members = await this.conversations.listMembers([conversationId], tx);
      // Полный DTO в payload (раунд 3): клиенты применяют событие локально по
      // seq без рефеча («буря рефечей»); собираем из данных транзакции.
      const payloadMessage = await this.mapper.toFreshDto(inserted, {
        viewerId: userId,
        members,
        replyOriginal: replyOriginalRow,
        attachments: claimedAttachments,
        tx,
      });
      await this.eventBus.emit(
        tx,
        CHAT_EVENTS.MESSAGE_SENT,
        {
          conversationId,
          messageId: inserted.id,
          seq: Number(inserted.seq),
          authorId: userId,
          threadRootId,
          forwarded: false,
          urgent,
          mentionedUserIds: mentionMatches,
          message: payloadMessage,
        },
        { actorId: userId, aggregateType: 'conversation', aggregateId: conversationId },
      );
      return { message: inserted, members, replayed: false };
    });
  }

  // ===== Правка =====

  /** Правка (#188): текст + опционально полный состав вложений. Только
   *  автор, без давности; editedAt — только при реальной смене (текст,
   *  состав или имена файлов). Упоминания пересчитываются по итоговому
   *  тексту (#176): токен — источник истины, правка меняет снапшот. */
  async edit(
    userId: string,
    conversationId: string,
    messageId: string,
    body: EditMessageBody,
  ): Promise<{ message: MessageRow; members: MemberRow[] }> {
    // Упоминания по итоговому тексту — ДО tx (как в send).
    const mentionMatches = await this.resolveMentions(conversationId, body.text, userId);
    return this.txRunner.run(async (tx) => {
      if (!(await this.conversations.findMembership(conversationId, userId, tx)))
        throw DomainException.notFound('Conversation not found');
      const message = await this.repo.findByIdInConversation(conversationId, messageId, tx);
      if (!message || message.deletedAt) throw DomainException.notFound('Message not found');
      // Блок перехода (#380) — запись журнала, а не текст: правка разошлась
      // бы с transition_records. Удаление — по общим правилам чата.
      if (message.kind !== 'text') {
        throw DomainException.forbidden('Only text messages can be edited');
      }
      if (message.authorId !== userId) {
        throw DomainException.forbidden('Only author can modify this message');
      }
      // Пересланную копию не правит даже переславший (#111, I8): текст под
      // атрибуцией «Переслано от» принадлежит оригинальному автору — правка
      // позволила бы исказить чужие слова (модель Telegram: только удаление).
      if (message.fwdMessageId) {
        throw DomainException.forbidden('Forwarded messages cannot be edited');
      }
      // Состав вложений правки — messages-edit-attachments.ts (#188, I5).
      const attachmentsChanged = await syncEditAttachments(
        { repo: this.repo, attachmentsRepo: this.attachmentsRepo },
        messageId,
        userId,
        body,
        tx,
      );
      // Накопительное множество упомянутых ДО правки (#239): ever хранит
      // ТОКЕНЫ (личные тэги + сентинел «Все», без разворота). Дифф-пинги
      // только ПЕРВЫЕ личные тэги; broadcast в истории личный тэг не глушит
      // (вердикт владельца 10.10: «@Все → @Анна — Анне высший»).
      const previousEver = readEverMentionedUserIds(message);
      // Токены НОВОЙ версии: личные id + сентинел «Все».
      const tokenIds = mentionTokenIds(body.text, userId);
      const directNewMentioned = tokenIds.filter((id) => id !== MENTION_ALL_ID);
      let updated = message;
      if (message.text !== body.text || attachmentsChanged.changed) {
        // Витрина #211: смена текста — замена строк ссылок, состав — Δ видов.
        const nextMentioned =
          message.text !== body.text ? mentionMatches : readMentionedUserIds(message);
        const everMentioned = Array.from(new Set([...previousEver, ...tokenIds]));
        await this.vault.applyMessageEdited(tx, message, body, attachmentsChanged);
        updated = await this.lifecycle.updateEditText(
          conversationId,
          messageId,
          userId,
          body.text,
          nextMentioned,
          everMentioned,
          tx,
        );
        // Новые упомянутые — наблюдатели трэда (#176), как отправка.
        if (message.text !== body.text) {
          await addMentionWatchers(
            this.threadParticipants,
            tx,
            message.threadRootId ?? messageId,
            mentionMatches,
            userId,
          );
        }
        // readAt сбрасывается выводно (editedAt > last_read_at читателей) —
        // «повторный пуш прочитавшим» (решение #41); состав вложений в
        // событии не разносится — подписчики дочитывают через API.
        // Дифф упоминаний (#239): payload несёт множества для notifications —
        // expanded новой версии (кому адресовано), ЛИЧНЫЕ тэги за историю,
        // флаг broadcast-«Все» в истории и личные тэги новой версии.
        await this.eventBus.emit(
          tx,
          CHAT_EVENTS.MESSAGE_EDITED,
          {
            conversationId,
            messageId,
            editedAt: updated.editedAt!.toISOString(),
            authorId: userId,
            text: updated.text,
            seq: Number(updated.seq),
            mentionedUserIds: nextMentioned,
            previousMentionedUserIds: previousEver.filter((id) => id !== MENTION_ALL_ID),
            previousMentionedAll: previousEver.includes(MENTION_ALL_ID),
            directMentionedUserIds: directNewMentioned,
          },
          { actorId: userId, aggregateType: 'conversation', aggregateId: conversationId },
        );
      }
      return {
        message: updated,
        members: await this.conversations.listMembers([conversationId], tx),
      };
    });
  }

  /** Упоминания send/edit (#176): токены → активные участники, ДО tx. */
  private resolveMentions(conversationId: string, text: string, authorId: string) {
    return resolveMentionTargets(
      this.userProfiles,
      this.conversations,
      conversationId,
      text,
      authorId,
    );
  }
}
