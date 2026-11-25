/**
 * Подготовка и побочные эффекты транзакции отправки (вынесено из
 * MessagesService — I5: транзакция отправки перевалила порог файла, шаблон
 * messages-edit-attachments). Содержимое — канон send(), вызывается только
 * из него, всегда внутри его транзакции (tx).
 */

import { CHAT_EVENTS, ErrorCode, type SendMessageBody, type StickerMeta } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type { EventBus } from '../../../core/events/event-bus.js';
import type { StickersRepository, StickerWithPackRow } from '../stickers/stickers.repository.js';
import type { MessageRow } from './message-row.js';
import type { MessagesRepository } from './messages.repository.js';
import { buildReplySnapshot } from './reply-snapshot.js';
import type { ThreadParticipantsRepository } from './thread-participants.repository.js';

/** Стикер (#143): доступ проверяется в транзакции (корпоративный |
 *  владеет | установлен); стикер-сообщение монолитно — текста и
 *  обычных вложений не несёт (модель Telegram, клиентский контракт).
 *  null — обычное сообщение (stickerId не передан). */
export async function resolveSendSticker(
  stickersRepo: Pick<StickersRepository, 'findSticker' | 'findPackAccessible'>,
  body: SendMessageBody,
  userId: string,
  tx: TransactionClient,
): Promise<StickerWithPackRow | null> {
  if (body.stickerId === undefined) return null;
  if (body.text.length > 0 || (body.attachmentIds?.length ?? 0) > 0) {
    throw new DomainException(
      ErrorCode.VALIDATION_FAILED,
      'Sticker message cannot carry text or attachments',
    );
  }
  const stickerHit = await stickersRepo.findSticker(body.stickerId, tx);
  if (!stickerHit) throw DomainException.notFound('Sticker not found');
  const accessible = await stickersRepo.findPackAccessible(stickerHit.pack.id, userId, tx);
  if (!accessible) throw DomainException.notFound('Sticker not found');
  return stickerHit;
}

/** Снапшот цитаты (оригинал — только этой беседы: чужое не утекает).
 *  replyOriginalRow — для DTO payload (toFreshDto); null у обоих — без цитаты.
 *  Оригинала нет в этой беседе — 404 (#344): иначе ссылка на сообщение чужой
 *  беседы сохранялась бы и раскрывала его автора/состояние при чтении. */
export async function loadReplyQuote(
  repo: Pick<MessagesRepository, 'findByIdInConversation' | 'attachmentsFor'>,
  conversationId: string,
  body: SendMessageBody,
  tx: TransactionClient,
): Promise<{
  replySnapshot: ReturnType<typeof buildReplySnapshot> | null;
  replyOriginalRow: MessageRow | null;
}> {
  if (!body.replyToId) return { replySnapshot: null, replyOriginalRow: null };
  const replyOriginalRow = await repo.findByIdInConversation(conversationId, body.replyToId, tx);
  if (!replyOriginalRow) throw DomainException.notFound('Reply target not found');
  const originalAttachments = replyOriginalRow.deletedAt
    ? []
    : await repo.attachmentsFor([replyOriginalRow.id], tx);
  const firstAttachment = originalAttachments[0];
  const sticker = firstAttachment?.kind === 'sticker' ? firstAttachment : null;
  const replySnapshot = buildReplySnapshot(
    {
      authorId: replyOriginalRow.authorId,
      text: replyOriginalRow.text,
      deleted: replyOriginalRow.deletedAt !== null,
      attachmentKind: (firstAttachment?.kind as 'image' | 'video' | 'file' | 'sticker') ?? null,
      // #288: мини-глиф оригинального стикера в цитате — fileId
      // (url подписывается при чтении) + первый эмодзи пака.
      stickerFileId: sticker?.fileId ?? null,
      stickerEmoji: (sticker?.stickerMeta as StickerMeta | null | undefined)?.emojis[0] ?? null,
      stickerMime: sticker?.mime ?? null,
    },
    body.quoteText ?? null,
  );
  return { replySnapshot, replyOriginalRow };
}

/** Зависимости эффектов ответа в тред (сокращённые Pick — тестируемость). */
export interface ThreadReplyDeps {
  repo: Pick<MessagesRepository, 'countThreadReplies'>;
  threadParticipants: Pick<ThreadParticipantsRepository, 'upsert' | 'advanceReadCursor'>;
  eventBus: Pick<EventBus, 'emit'>;
}

/** Ответ в тред: участники треда, watermark реплайера, первый ответ —
 *  событие THREAD_CREATED (в той же транзакции отправки). */
export async function applyThreadReplyEffects(
  deps: ThreadReplyDeps,
  input: {
    userId: string;
    conversationId: string;
    threadRootId: string;
    threadRoot: MessageRow | null;
    inserted: MessageRow;
  },
  tx: TransactionClient,
): Promise<void> {
  const { userId, conversationId, threadRootId, threadRoot, inserted } = input;
  // Автор корня — участник треда с момента первого ответа (уведомления).
  if (threadRoot && threadRoot.authorId !== userId) {
    await deps.threadParticipants.upsert(threadRootId, threadRoot.authorId, 'author', tx);
  }
  await deps.threadParticipants.upsert(threadRootId, userId, 'replier', tx);
  // Свой ответ = «я видел тред до сюда» (модель Telegram): watermark
  // трэда реплайера доходит до seq ответа — прежние чужие ответы не
  // вспыхивают «непрочитанными» у только что подключившегося.
  await deps.threadParticipants.advanceReadCursor(threadRootId, userId, inserted.seq, tx);
  const priorReplies = await deps.repo.countThreadReplies(threadRootId, inserted.id, tx);
  if (priorReplies === 0) {
    await deps.eventBus.emit(
      tx,
      CHAT_EVENTS.THREAD_CREATED,
      { conversationId, threadRootId, messageId: inserted.id },
      { actorId: userId, aggregateType: 'conversation', aggregateId: conversationId },
    );
  }
}
