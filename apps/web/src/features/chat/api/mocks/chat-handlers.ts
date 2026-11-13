import type { ChatMessage, ConversationListItem, MessageAttachment } from '@nodus/contracts';
import {
  conversationUpdateBodySchema,
  createConversationBodySchema,
  ErrorCode,
  readConversationBodySchema,
  saveConversationDraftBodySchema,
  sendMessageBodySchema,
} from '@nodus/contracts';

import { http, HttpResponse } from 'msw';

import { demoConversations, demoMessages } from '../../../../shared/mocks/data/chat.js';
import { demoTasks } from '../../../../shared/mocks/data/tasks.js';
import { demoUserListItems, userRef } from '../../../../shared/mocks/data/users.js';
import { actorUserRef, getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { chatMutationHandlers } from './chat-mutation-handlers.js';
import { conversationMutationHandlers } from './conversation-mutation-handlers.js';
import { favoriteHandlers } from './favorite-handlers.js';
import { letterConversationHandlers } from './letter-conversation-handlers.js';
import { projectConversationHandlers } from './project-conversation-handlers.js';
import { vaultHandlers } from './vault-handlers.js';
import { findSticker } from './sticker-mock-state.js';
import { stickerHandlers } from './sticker-handlers.js';
import {
  applyReadReceipt,
  applyThreadReadReceipt,
  buildReplyPreview,
  hiddenConversations,
  mockMentionTargets,
  nextMessageSeq,
  revealHiddenConversation,
  threadStatesMock,
  threadWatchersOf,
  uploadedAttachments,
  watchThreadMock,
} from './chat-mock-state.js';

const conversationHandlers = [
  // Политика важных (#177): счётчик попапа молнии. Мок отдаёт полный лимит
  // (NOTIFY_URGENT_DAILY_LIMIT дефолт) — исчерпание демонстрирует живой стек.
  http.get('/api/v1/chat/urgent/policy', () =>
    HttpResponse.json({ remaining: 3, limit: 3, resetAt: null, groupMax: 20 }),
  ),
  /** Вкладки мессенджера (#252): scope=chats — люди и каналы, entities —
   *  чаты задач и писем, без параметра — всё (пикеры, гейт ленты). */
  http.get('/api/v1/chat/conversations', ({ request }) => {
    const scope = new URL(request.url).searchParams.get('scope') ?? 'all';
    const entity = (c: ConversationListItem) => c.type === 'task' || c.type === 'letter';
    return HttpResponse.json({
      items: demoConversations.filter(
        (c) =>
          !hiddenConversations.has(c.id) &&
          (scope === 'all' || (scope === 'entities' ? entity(c) : !entity(c))),
      ),
      nextCursor: null,
    });
  }),

  /** Сводка непрочитанных по вкладкам (#409): та же семантика, что у
   *  серверного unread-summary — сумма unreadCount по всем видимым беседам,
   *  скрытые и «посмотреть позже» не входят. */
  http.get('/api/v1/chat/conversations/unread-summary', () => {
    const visible = demoConversations.filter((c) => !hiddenConversations.has(c.id) && !c.snoozed);
    const entity = (c: ConversationListItem) => c.type === 'task' || c.type === 'letter';
    const sum = (items: ConversationListItem[]) =>
      items.reduce((total, c) => total + c.unreadCount, 0);
    const chats = sum(visible.filter((c) => !entity(c)));
    const entities = sum(visible.filter(entity));
    return HttpResponse.json({ chats, entities, total: chats + entities });
  }),

  /** Чат задачи (#252): find-or-create беседы `type='task'` по задаче;
   *  состав — постановщик, ответственный и участники задачи. */
  http.get('/api/v1/chat/conversations/by-task/:taskId', ({ params }) => {
    const taskId = String(params.taskId);
    const existing = demoConversations.find((c) => c.type === 'task' && c.task?.id === taskId);
    if (existing) return HttpResponse.json(existing);
    const task = demoTasks.find((t) => t.id === taskId);
    if (!task)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Task not found' },
        { status: 404 },
      );
    const members = [task.creator, task.assignee, ...task.participants].filter(
      (m, i, all): m is NonNullable<typeof m> =>
        m !== null && all.findIndex((x) => x?.id === m.id) === i,
    );
    const conversation: ConversationListItem = {
      id: crypto.randomUUID(),
      type: 'task',
      title: null,
      avatarUrl: null,
      myRole: 'member',
      permissions: {
        changeInfo: 'admin',
        addMembers: 'member',
        removeMembers: 'admin',
        post: 'member',
        manageSettings: 'owner',
      },
      draft: null,
      visibility: null,
      description: null,
      project: task.project,
      task: { id: task.id, number: task.number, title: task.title },
      letter: null,
      membersPreview: members,
      membersCount: members.length,
      lastMessage: null,
      lastActivityAt: null,
      unreadCount: 0,
      myLastReadSeq: 0,
      pinned: false,
      muted: false,
      snoozed: false,
    };
    demoConversations.push(conversation);
    return HttpResponse.json(conversation);
  }),

  /** Личный диалог с сотрудником (карточка сотрудника — чат всегда справа):
   * find-or-create по участнику (идемпотентно); диалог с собой — «заметки
   * для себя» (модель «Избранного» мессенджеров). */
  http.post('/api/v1/chat/conversations/direct/:userId', ({ params }) => {
    const userId = String(params.userId);
    const actorId = getMockActor().id;
    const existing = demoConversations.find(
      (c) =>
        c.type === 'direct' &&
        (userId === actorId
          ? c.membersPreview.length === 1 && c.membersPreview[0]?.id === actorId
          : c.membersPreview.some((m) => m.id === userId)),
    );
    if (existing) return HttpResponse.json(existing);
    const person = demoUserListItems.find((u) => u.id === userId);
    if (!person)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        { status: 404 },
      );
    const conversation: ConversationListItem = {
      id: crypto.randomUUID(),
      type: 'direct',
      title: null,
      avatarUrl: null,
      myRole: 'member',
      permissions: {
        changeInfo: 'admin',
        addMembers: 'member',
        removeMembers: 'admin',
        post: 'member',
        manageSettings: 'owner',
      },
      draft: null,
      visibility: null,
      description: null,
      project: null,
      task: null,
      letter: null,
      membersPreview: [userRef(person.id)],
      membersCount: person.id === actorId ? 1 : 2,
      lastMessage: null,
      lastActivityAt: null,
      unreadCount: 0,
      myLastReadSeq: 0,
      pinned: false,
      muted: false,
      snoozed: false,
    };
    demoConversations.push(conversation);
    return HttpResponse.json(conversation, { status: 201 });
  }),

  /** Живые сообщения беседы по id (окно перехода, #380): только участник —
   *  мок считает демо-юзера участником всех бесед. Отсутствующие выпадают. */
  http.get('/api/v1/chat/conversations/:id/messages/lookup', ({ params, request }) => {
    const ids = new Set(
      (new URL(request.url).searchParams.get('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const conversation = demoConversations.find((c) => c.id === params.id);
    if (!conversation)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Conversation not found' },
        { status: 404 },
      );
    const items = demoMessages
      .filter((m) => m.conversationId === params.id && ids.has(m.id) && !m.deletedAt)
      .sort((a, b) => a.seq - b.seq);
    return HttpResponse.json({ items });
  }),

  /** Сообщения беседы; с threadRootId — тред канала: корень + ответы
   *  (ровно один уровень, корень первым). Просмотры (readAt/readBy) —
   *  watermark-модель #102 раунд 2: двигаются ТОЛЬКО квитанциями
   *  POST /read (applyReadReceipt), выдача ленты их не трогает. */
  http.get('/api/v1/chat/conversations/:id/messages', ({ params, request }) => {
    const threadRootId = new URL(request.url).searchParams.get('threadRootId');
    const all = demoMessages.filter((m) => m.conversationId === params.id);
    const items = threadRootId
      ? [
          ...all.filter((m) => m.id === threadRootId),
          ...all.filter((m) => m.threadRootId === threadRootId),
        ]
      : all;
    return HttpResponse.json({ items, nextCursor: null });
  }),

  /** Квитанция просмотров (#102 раунд 2; threadRootId — раунд 3): seq самой
   *  новой видимой строки вьюпорта; мок двигает просмотры СВОИХ сообщений до
   *  upToSeq (симуляция собеседника «просматривает видимое по мере
   *  прокрутки», минимально — по квитанции клиента). Идемпотентна. */
  http.post('/api/v1/chat/conversations/:id/read', async ({ params, request }) => {
    const parsed = readConversationBodySchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 422 },
      );
    const conversationId = String(params.id);
    if (parsed.data.threadRootId) {
      const root = demoMessages.find(
        (m) => m.id === parsed.data.threadRootId && m.conversationId === conversationId,
      );
      if (!root)
        return HttpResponse.json(
          { code: ErrorCode.NOT_FOUND, message: 'Thread root not found' },
          { status: 404 },
        );
      applyThreadReadReceipt(parsed.data.threadRootId, getMockActor().id, parsed.data.upToSeq);
    }
    const upToSeq = applyReadReceipt(conversationId, parsed.data.upToSeq);
    if (upToSeq < 0)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Conversation not found' },
        { status: 404 },
      );
    return HttpResponse.json({ upToSeq });
  }),

  /** Состояния трэдов текущего пользователя (раунд 3): точка «есть новые» на
   *  посте и кнопка «Следить» — только наблюдателям трэда. */
  http.get('/api/v1/chat/conversations/:id/threads/state', ({ params }) =>
    HttpResponse.json({
      items: threadStatesMock(String(params.id), getMockActor().id),
    }),
  ),

  /** Кнопка «Следить/Перестать» в шапке окна треда (toggle, раунд 3). */
  http.post('/api/v1/chat/conversations/:id/threads/:rootId/watch', ({ params }) => {
    const root = demoMessages.find(
      (m) => m.id === String(params.rootId) && m.conversationId === String(params.id),
    );
    if (!root)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Thread root not found' },
        { status: 404 },
      );
    return HttpResponse.json({
      watching: watchThreadMock(String(params.rootId), getMockActor().id),
    });
  }),

  /** Отправка сообщения (sendMessageBodySchema): в тред — с threadRootId,
   * счётчик ответов корня растёт (лента канала читает его без загрузки треда);
   * ответ-цитата — replyToId (+quoteText частичной цитаты), снапшот frozen;
   * вложения — attachmentIds загруженных через POST /chat/attachments (A1). */
  http.post('/api/v1/chat/conversations/:id/messages', async ({ params, request }) => {
    const parsed = sendMessageBodySchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 422 },
      );
    const threadRootId = parsed.data.threadRootId ?? null;
    if (threadRootId && !demoMessages.some((m) => m.id === threadRootId)) {
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Thread root not found' },
        { status: 404 },
      );
    }
    // Стикер (#143): снапшот-вложение kind='sticker' с метаданными пака —
    // доступ проверяет живой сервер (корпоративный | свой | установленный).
    let stickerAttachment: MessageAttachment | null = null;
    if (parsed.data.stickerId) {
      const hit = findSticker(parsed.data.stickerId);
      if (!hit) {
        return HttpResponse.json(
          { code: ErrorCode.NOT_FOUND, message: 'Sticker not found' },
          { status: 404 },
        );
      }
      const ext = hit.sticker.mime.split('/')[1] ?? 'png';
      stickerAttachment = {
        id: crypto.randomUUID(),
        fileId: hit.sticker.id,
        name: `sticker.${ext}`,
        size: hit.sticker.size,
        mime: hit.sticker.mime,
        kind: 'sticker',
        url: hit.sticker.url,
        thumbnailUrl: null,
        previewKind: 'image',
        pdfUrl: null,
        width: hit.sticker.width,
        height: hit.sticker.height,
        sticker: {
          packId: hit.pack.id,
          packTitle: hit.pack.title,
          packScope: hit.pack.scope,
          emojis: hit.sticker.emojis,
        },
      };
    }
    const attachments = stickerAttachment
      ? [stickerAttachment]
      : (parsed.data.attachmentIds ?? [])
          .map((attachmentId) => uploadedAttachments.get(attachmentId))
          .filter((a): a is MessageAttachment => a !== undefined);
    // Переименования окна отправки (#146): паритет с сервером — имя
    // применяется до сборки DTO сообщения (в живой БД — в транзакции claim).
    for (const rename of parsed.data.attachmentRenames ?? []) {
      const target = attachments.find((a) => a.id === rename.id);
      if (target) target.name = rename.name;
    }
    for (const attachment of attachments) uploadedAttachments.delete(attachment.id);
    revealHiddenConversation(String(params.id)); // активность раскрывает беседу (#103)
    const seq = nextMessageSeq(String(params.id));
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: String(params.id),
      seq,
      // Связка темпа с серверной записью (#243): ключ идемпотентности
      // запроса = clientMessageId (паритет живому серверу).
      clientMessageId: request.headers.get('Idempotency-Key') ?? crypto.randomUUID(),
      author: actorUserRef(),
      text: parsed.data.text,
      replyToId: parsed.data.replyToId ?? null,
      reply: parsed.data.replyToId
        ? buildReplyPreview(parsed.data.replyToId, parsed.data.quoteText)
        : null,
      deletedAt: null,
      pinned: false,
      forwardedFrom: null,
      threadRootId,
      threadRepliesCount: 0,
      reactions: [],
      attachments,
      editedAt: null,
      readAt: null,
      readBy: [],
      urgent: parsed.data.urgent ?? false,
      mentionedUserIds: [],
      linkPreview: null,
      createdAt: new Date().toISOString(),
    };
    demoMessages.push(message);
    if (threadRootId) {
      const root = demoMessages.find((m) => m.id === threadRootId);
      if (root) root.threadRepliesCount += 1;
      // Ответ в трэд делает наблюдателем (паритет серверу, раунд 3).
      const watchers = threadWatchersOf(threadRootId);
      if (!watchers.has(getMockActor().id)) watchers.set(getMockActor().id, 0);
    }
    // @упоминания (#176): токены `@[текст](user:id)` → снапшот сообщения
    // + упомянутые — наблюдатели трэда этого сообщения (паритет серверу).
    const actorId = getMockActor().id;
    const mentionIds = mockMentionTargets(parsed.data.text, actorId, (id) =>
      demoUserListItems.some((u) => u.id === id),
    );
    message.mentionedUserIds = mentionIds;
    for (const mentionedId of mentionIds) {
      const watchers = threadWatchersOf(threadRootId ?? message.id);
      if (!watchers.has(mentionedId)) watchers.set(mentionedId, 0);
    }
    const conversation = demoConversations.find((c) => c.id === params.id);
    if (conversation && !threadRootId) conversation.lastMessage = message;
    // Новое сообщение снимает «Посмотреть позже»: счётчик снова виден.
    // Отправка ГАСИТ черновик (контракт #91, урок tdesktop#26236): сервер
    // делает это в транзакции отправки, а не клиент по клику «Отправить».
    if (conversation) {
      conversation.snoozed = false;
      conversation.draft = null;
    }
    return HttpResponse.json(message, { status: 201 });
  }),

  /** Черновик пользователя (контракт #91): клиент шлёт PUT с debounce 1000 мс
   *  после паузы набора + flush при переключении беседы и скрытии вкладки;
   *  пустой текст = очистка. revision растёт монотонно (last-write-wins). */
  http.put('/api/v1/chat/conversations/:id/draft', async ({ params, request }) => {
    const parsed = saveConversationDraftBodySchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 422 },
      );
    const conversation = demoConversations.find((c) => c.id === params.id);
    if (!conversation)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Conversation not found' },
        { status: 404 },
      );
    conversation.draft = parsed.data.text
      ? {
          text: parsed.data.text,
          revision: (conversation.draft?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        }
      : null;
    return HttpResponse.json(conversation.draft);
  }),

  /** Создание группового чата/канала (#91, реф окна Bitrix24): владелец —
   *  первый участник, матрица прав — дефолты сервера, аватарка — цветная
   *  заглушка из инициалов до старта MinIO (#57, право загрузки changeInfo). */
  http.post('/api/v1/chat/conversations', async ({ request }) => {
    const parsed = createConversationBodySchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 422 },
      );
    const members = (parsed.data.memberIds ?? [])
      .filter((id) => demoUserListItems.some((u) => u.id === id))
      .map((id) => userRef(id));
    const conversation: ConversationListItem = {
      id: crypto.randomUUID(),
      type: parsed.data.type,
      title: parsed.data.title,
      avatarUrl: null,
      myRole: 'owner',
      permissions: {
        changeInfo: 'admin',
        addMembers: 'member',
        removeMembers: 'admin',
        post: 'member',
        manageSettings: 'owner',
      },
      draft: null,
      visibility: parsed.data.visibility ?? 'closed',
      description: parsed.data.description ?? null,
      project: null,
      task: null,
      letter: null,
      membersPreview: [actorUserRef(), ...members],
      membersCount: 1 + members.length,
      lastMessage: null,
      lastActivityAt: null,
      unreadCount: 0,
      myLastReadSeq: 0,
      pinned: false,
      muted: false,
      snoozed: false,
    };
    demoConversations.unshift(conversation);
    return HttpResponse.json(conversation, { status: 201 });
  }),

  /** Контекстное меню беседы (ПКМ, реф Битрикс24, вердикт 14.09.2026):
   *  закрепить / звук / «посмотреть позже» / скрыть из списка. */
  http.patch('/api/v1/chat/conversations/:id', async ({ params, request }) => {
    const parsed = conversationUpdateBodySchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 422 },
      );
    const conversation = demoConversations.find((c) => c.id === params.id);
    if (!conversation)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Conversation not found' },
        { status: 404 },
      );
    const { hidden, ...flags } = parsed.data;
    Object.assign(conversation, flags);
    if (hidden !== undefined) {
      if (hidden) hiddenConversations.add(conversation.id);
      else hiddenConversations.delete(conversation.id);
    }
    return HttpResponse.json(conversation);
  }),
];

/** Единый агрегат мок-хендлеров чата: беседы/лента/отправка + мутации
 *  сообщений линии A (chat-mutation-handlers.ts). Порядок важен: более
 *  специфичные маршруты (:id/pins, :id/forward) MSW матчит по шаблону,
 *  конфликтов с :id/messages нет. */
export const chatHandlers = [
  // Буквальные by-letter/by-project — до параметрических маршрутов бесед
  // (gotcha msw-query).
  ...letterConversationHandlers,
  ...projectConversationHandlers,
  ...conversationHandlers,
  ...conversationMutationHandlers,
  ...chatMutationHandlers,
  ...stickerHandlers,
  ...favoriteHandlers,
  ...vaultHandlers,
];
