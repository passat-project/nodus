import type { ChatMessage, MessageAttachment } from '@nodus/contracts';
import {
  batchDeleteMessagesBodySchema,
  editMessageBodySchema,
  ErrorCode,
  forwardMessagesBodySchema,
  messageReactionToggleBodySchema,
} from '@nodus/contracts';

import { http, HttpResponse } from 'msw';

import { demoConversations, demoMessages } from '../../../../shared/mocks/data/chat.js';
import { actorUserRef, getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  applyDeletion,
  collapseAnchors,
  hasLiveReplies,
  isSelfConversation,
  mockMentionTargets,
  nextMessageSeq,
  pinMessage,
  pinsOf,
  refreshLastMessage,
  removeMessage,
  threadWatchersOf,
  toggleReaction,
  unpinById,
  uploadedAttachments,
  revealHiddenConversation,
} from './chat-mock-state.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';

/**
 * Мутации сообщений линии A (#87): загрузка вложений, правка, удаление
 * (без следа / со следом — правило решает «сервер»), закрепы, пересылка.
 * Ответы — строго контракты chat.schemas (мок ≠ контракту = баг).
 */

function notFound(message = 'Message not found') {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message }, { status: 404 });
}

function validationFailed() {
  return HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );
}

function forbidden(message = 'Only author can modify this message') {
  return HttpResponse.json({ code: ErrorCode.FORBIDDEN, message }, { status: 403 });
}

function findMessage(conversationId: unknown, messageId: unknown): ChatMessage | undefined {
  return demoMessages.find(
    (m) => m.id === String(messageId) && m.conversationId === String(conversationId),
  );
}

export const chatMutationHandlers = [
  /** Загрузка вложения (multipart): сообщение хранит attachmentIds
   *  (задел POST /chat/attachments из плана бэкенда, трек 5). MOCK-СОГЛАШЕНИЕ:
   *  клиент передаёт previewUrl (objectURL) и габариты изображения — blob-URL,
   *  созданный в service worker, в странице не резолвится; в проде url/превью
   *  даёт MinIO через StorageDriver (I13), поля-подсказки игнорируются. */
  http.post('/api/v1/chat/attachments', async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return validationFailed();
    const previewUrl = form.get('previewUrl');
    const width = Number(form.get('width'));
    const height = Number(form.get('height'));
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const durationRaw = Number(form.get('durationMs'));
    const attachment: MessageAttachment = {
      id: crypto.randomUUID(),
      fileId: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      kind: isImage ? 'image' : isVideo ? 'video' : 'file',
      url: typeof previewUrl === 'string' && previewUrl ? previewUrl : null,
      thumbnailUrl: isImage && typeof previewUrl === 'string' ? previewUrl : null,
      previewKind: isImage ? 'image' : isVideo ? 'video' : 'file',
      pdfUrl: null,
      width: (isImage || isVideo) && Number.isFinite(width) && width > 0 ? Math.round(width) : null,
      height:
        (isImage || isVideo) && Number.isFinite(height) && height > 0 ? Math.round(height) : null,
      durationMs:
        isVideo && Number.isFinite(durationRaw) && durationRaw >= 0
          ? Math.round(durationRaw)
          : null,
    };
    uploadedAttachments.set(attachment.id, attachment);
    return HttpResponse.json(attachment, { status: 201 });
  }),

  /** Отмена неотправленного вложения (#57): крестик готовой карточки в трее —
   *  освобождает место (лимит 20). Зеркалит живой best-effort DELETE. */
  http.delete('/api/v1/chat/attachments/:id', ({ params }) => {
    uploadedAttachments.delete(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),

  /** Правка (A4 + #188): editedAt — только при реальной смене (текст, состав
   *  вложений, имена); readAt сбрасывается — «повторный пуш прочитавшим»
   *  (решение #41). Состав: attachmentIds = итоговый список — убранные
   *  отвязываются, новые забираются из загруженных (uploadedAttachments),
   *  порядок = списку; переименования применяются к строкам сообщения.
   *  Закрепы держат ссылку на объект — пин-бар обновляется реактивно. */
  http.patch('/api/v1/chat/conversations/:id/messages/:messageId', async ({ params, request }) => {
    const parsed = editMessageBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const message = findMessage(params.id, params.messageId);
    if (!message || message.deletedAt) return notFound();
    if (message.author.id !== getMockActor().id) return forbidden();
    // Паритет с бэком (#111): пересланную копию не правит даже переславший.
    if (message.forwardedFrom) return forbidden('Forwarded messages cannot be edited');
    const body = parsed.data;
    let changed = message.text !== body.text;
    const touchesAttachments =
      body.attachmentIds !== undefined || body.attachmentRenames !== undefined;
    if (touchesAttachments && message.attachments.some((a) => a.sticker)) {
      return forbidden('Sticker messages cannot be edited');
    }
    if (body.attachmentIds !== undefined) {
      const next = body.attachmentIds.flatMap((id) => {
        const kept = message.attachments.find((a) => a.id === id);
        if (kept) return [kept];
        const uploaded = uploadedAttachments.get(id);
        return uploaded ? [uploaded] : [];
      });
      // Инвариант непустоты (паритет с сервером, security-ревью #188):
      // мусорный id не оставляет сообщение без текста и вложений — проверка
      // ДО мутации стора (сервер откатывает транзакцию целиком).
      if (body.text.trim().length === 0 && next.length === 0) {
        return validationFailed();
      }
      for (const attachment of next) uploadedAttachments.delete(attachment.id);
      changed =
        changed ||
        next.length !== message.attachments.length ||
        next.some((a, i) => a.id !== message.attachments[i]!.id);
      message.attachments = next;
    }
    if (body.attachmentRenames !== undefined && body.attachmentRenames.length > 0) {
      for (const rename of body.attachmentRenames) {
        const target = message.attachments.find((a) => a.id === rename.id);
        if (target && target.name !== rename.name) {
          target.name = rename.name;
          changed = true;
        }
      }
    }
    if (changed) {
      message.text = body.text;
      message.editedAt = new Date().toISOString();
      message.readAt = null;
      // Упоминания пересчитываются по итоговому тексту (#176, паритет
      // серверу): новые упомянутые — наблюдатели трэда, убранные — нет.
      const mentionIds = mockMentionTargets(body.text, message.author.id, (id) =>
        demoUserListItems.some((u) => u.id === id),
      );
      message.mentionedUserIds = mentionIds;
      for (const mentionedId of mentionIds) {
        const watchers = threadWatchersOf(message.threadRootId ?? message.id);
        if (!watchers.has(mentionedId)) watchers.set(mentionedId, 0);
      }
    }
    return HttpResponse.json(message);
  }),

  /** Удаление (#163): нет живых ответов → 204 без следа; есть ответы →
   *  200 + надгробие. «Избранное» (#215): беседа с собой — всегда бесследно.
   *  Каскад: надгробие-якорь без живых ответов уходит. */
  http.delete('/api/v1/chat/conversations/:id/messages/:messageId', ({ params }) => {
    const message = findMessage(params.id, params.messageId);
    if (!message || message.deletedAt) return notFound();
    if (message.author.id !== getMockActor().id) return forbidden();
    const conversationId = String(params.id);
    // Якоря — до applyDeletion (та обнуляет reply).
    const anchors = [message.reply?.id, message.threadRootId];
    if (!isSelfConversation(conversationId) && hasLiveReplies(message)) {
      applyDeletion(message);
      collapseAnchors(conversationId, anchors);
      refreshLastMessage(conversationId);
      return HttpResponse.json(message);
    }
    removeMessage(message.id);
    collapseAnchors(conversationId, anchors);
    refreshLastMessage(conversationId);
    return new HttpResponse(null, { status: 204 });
  }),

  /** Пакетное удаление (A6): лимит 100 — схемой; чужие/уже удалённые —
   *  пропускаются (канон tdesktop: действие доступно только когда применимо
   *  ко всем — клиент кнопку не показывает, сервер страховкой). */
  http.post('/api/v1/chat/conversations/:id/messages/batch-delete', async ({ params, request }) => {
    const parsed = batchDeleteMessagesBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const removed: string[] = [];
    const tombstones: ChatMessage[] = [];
    for (const id of parsed.data.messageIds) {
      const message = findMessage(params.id, id);
      if (!message || message.deletedAt) continue;
      if (message.author.id !== getMockActor().id) continue;
      const anchors = [message.reply?.id, message.threadRootId];
      if (!isSelfConversation(String(params.id)) && hasLiveReplies(message)) {
        tombstones.push(applyDeletion(message));
      } else {
        removeMessage(id);
        removed.push(id);
      }
      collapseAnchors(String(params.id), anchors);
    }
    refreshLastMessage(String(params.id));
    return HttpResponse.json({ removed, tombstones });
  }),

  /** Закрепы (A3): список — снапшотами (закреп может быть вне окна ленты). */
  http.get('/api/v1/chat/conversations/:id/pins', ({ params }) =>
    HttpResponse.json({ items: pinsOf(String(params.id)), nextCursor: null }),
  ),

  http.post('/api/v1/chat/conversations/:id/messages/:messageId/pin', ({ params }) => {
    const pin = pinMessage(String(params.id), String(params.messageId));
    if (!pin) return notFound();
    return HttpResponse.json(pin, { status: 201 });
  }),

  http.delete('/api/v1/chat/conversations/:id/messages/:messageId/pin', ({ params }) => {
    if (!unpinById(String(params.id), String(params.messageId))) return notFound();
    return new HttpResponse(null, { status: 204 });
  }),

  /** Реакции (#124): toggle своей реакции — паритет серверному эндпоинту
   *  message-actions (mine — против актёра мока). */
  http.post(
    '/api/v1/chat/conversations/:id/messages/:messageId/reactions',
    async ({ params, request }) => {
      const parsed = messageReactionToggleBodySchema.safeParse(await request.json());
      if (!parsed.success) return validationFailed();
      const message = findMessage(params.id, params.messageId);
      if (!message) return notFound();
      toggleReaction(message, parsed.data.emoji, parsed.data.remove === true);
      return HttpResponse.json(message);
    },
  ),

  /** Пересылка (A7): серверные копии в целевую беседу (вложения — по ссылке,
   *  не перекачиваются); комментарий — отдельным сообщением ПЕРЕД блоком
   *  (канон Telegram ShareBox); threadRootId — цель внутри треда канала.
   *  Reply-контекст оригинала теряется (классика Telegram). */
  http.post('/api/v1/chat/conversations/:id/forward', async ({ params, request }) => {
    const parsed = forwardMessagesBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const target = demoConversations.find((c) => c.id === String(params.id));
    if (!target) return notFound('Conversation not found');
    const threadRootId = parsed.data.threadRootId ?? null;
    const root = threadRootId
      ? demoMessages.find((m) => m.id === threadRootId && m.conversationId === target.id)
      : undefined;
    if (threadRootId && !root) return notFound('Thread root not found');

    const created: ChatMessage[] = [];
    const stamp = (offset: number) => new Date(Date.now() + offset).toISOString();
    let seq = nextMessageSeq(target.id);
    revealHiddenConversation(target.id); // пересылка — активность, раскрывает беседу (#103)
    if (parsed.data.comment) {
      const comment: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId: target.id,
        seq: seq++,
        clientMessageId: crypto.randomUUID(),
        author: actorUserRef(),
        text: parsed.data.comment,
        replyToId: null,
        reply: null,
        threadRootId,
        threadRepliesCount: 0,
        reactions: [],
        attachments: [],
        editedAt: null,
        deletedAt: null,
        pinned: false,
        forwardedFrom: null,
        readAt: null,

        readBy: [],
        urgent: false,
        mentionedUserIds: [],
        linkPreview: null,
        createdAt: stamp(0),
      };
      created.push(comment);
    }
    parsed.data.messageIds.forEach((id, index) => {
      const source = demoMessages.find(
        (m) => m.id === id && m.conversationId === parsed.data.sourceConversationId,
      );
      if (!source || source.deletedAt) return;
      const copy: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId: target.id,
        seq: seq++,
        // Копия пересылки: свой ключ отправки (паритет серверу — суффикс «:i»).
        clientMessageId: crypto.randomUUID(),
        author: actorUserRef(),
        text: source.text,
        replyToId: null,
        reply: null,
        threadRootId,
        threadRepliesCount: 0,
        reactions: [],
        attachments: source.attachments,
        editedAt: null,
        deletedAt: null,
        pinned: false,
        forwardedFrom: {
          author: source.author,
          conversationId: source.conversationId,
          messageId: source.id,
          threadRootId: source.threadRootId,
        },
        readAt: null,

        readBy: [],
        urgent: false,
        mentionedUserIds: [],
        linkPreview: null,
        createdAt: stamp(index + 1),
      };
      created.push(copy);
      if (root) root.threadRepliesCount += 1;
    });
    if (created.length === 0) return notFound('No messages to forward');
    demoMessages.push(...created);
    if (threadRootId && root) {
      // Пересылка в тред — участие (паритет серверу, раунд 3).
      const watchers = threadWatchersOf(threadRootId);
      if (!watchers.has(getMockActor().id)) watchers.set(getMockActor().id, 0);
    }
    const lastCreated = created[created.length - 1];
    if (!threadRootId && lastCreated) target.lastMessage = lastCreated;
    target.snoozed = false;
    return HttpResponse.json(created, { status: 201 });
  }),
];
