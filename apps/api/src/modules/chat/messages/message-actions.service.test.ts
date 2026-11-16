import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForwardMessagesBody } from '@nodus/contracts';

import { MessageActionsService } from './message-actions.service.js';

/**
 * Пересылка минимальным хэппи-путем: проверяется побочный эффект revealHidden
 * (#103: активность раскрывает беседу скрывшим) в той же транзакции —
 * полный контракт пересылки покрыт integration-тестами чата.
 */

const ME = 'me-1';
const TARGET = 'conv-target';
const SOURCE = 'conv-source';
const TX = 'TX';
/** Актёр пересылки: userId + права токена (для канала проекта — canPost). */
const ACTOR = { id: ME, permissions: [] as string[] };

function makeService() {
  const messages = {
    allocateSeqs: vi.fn(async () => [8n, 9n, 10n]),
    // Возвращает вставленную строку (не true): payload читает clientMessageId (#239).
    insertMessage: vi.fn(async (draft: Record<string, unknown>) => ({ ...draft })),
    copyAttachments: vi.fn(),
    findExistingByKeys: vi.fn(async (): Promise<Record<string, unknown>[]> => []),
    touchLastMessageAt: vi.fn(),
    countThreadReplies: vi.fn(),
    countAllThreadReplies: vi.fn(),
    attachmentsFor: vi.fn(async () => []),
    findByIdInConversation: vi.fn(),
    findForwardSources: vi.fn(async () => [
      { id: 'src-1', text: 'текст', deletedAt: null, authorId: 'a-1', threadRootId: null },
    ]),
  };
  const threadParticipants = { upsert: vi.fn() };
  const conversations = {
    findMembership: vi.fn(async () => ({ role: 'owner' })),
    findTypeAndPermissions: vi.fn(
      async (): Promise<{
        type: string;
        projectId: string | null;
        permissions: { post: string };
      }> => ({
        type: 'group',
        projectId: null,
        permissions: { post: 'member' },
      }),
    ),
    listMembers: vi.fn(async () => []),
    listMembersPage: vi.fn(async (_c: string, opts: { searchUserIds?: string[] }) =>
      (opts.searchUserIds ?? []).map((userId) => ({ userId, role: 'member' })),
    ),
    unsnooze: vi.fn(),
    revealHidden: vi.fn(),
  };
  const mapper = { toDtos: vi.fn(), toFreshDto: vi.fn() };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const userProfiles = {
    findRefs: vi.fn(async () => []),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids),
  };
  const projectChat = { canPost: vi.fn(async () => true) };
  const service = new MessageActionsService(
    messages as never,
    messages as never, // запись (MessagesWriteRepository)
    conversations as never,
    conversations as never, // запись участия (ConversationMembersRepository)
    mapper as never,
    txRunner as never,
    eventBus as never,
    userProfiles as never,
    threadParticipants as never,
    {
      applyMessageSent: vi.fn(async () => {}),
      applyMessageEdited: vi.fn(async () => {}),
      applyMessageDeleted: vi.fn(async () => {}),
      applyForwardCopies: vi.fn(async () => {}),
    } as never,
    projectChat as never,
  );
  return { service, conversations, messages, mapper, eventBus, userProfiles, projectChat };
}

describe('MessageActionsService.forward — раскрытие скрытой беседы (#103)', () => {
  let conversations: ReturnType<typeof makeService>['conversations'];
  let service: MessageActionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ service, conversations } = makeService());
  });

  it('пересылка раскрывает беседу-приёмник в той же транзакции', async () => {
    const body: ForwardMessagesBody = {
      sourceConversationId: SOURCE,
      messageIds: ['src-1'],
      comment: 'вот это',
    };
    await service.forward(ACTOR, TARGET, body, 'fwd-key');
    expect(conversations.unsnooze).toHaveBeenCalledWith(TARGET, ME, TX);
    expect(conversations.revealHidden).toHaveBeenCalledWith(TARGET, TX);
  });
});

describe('MessageActionsService.forward — payload DTO (раунд 3)', () => {
  it('профили читаются ПО соединению транзакции (tx), не общим пулом', async () => {
    const { service, messages, mapper } = makeService();
    messages.insertMessage.mockImplementation((async (input: { id: string; seq: bigint }) => ({
      id: input.id,
      conversationId: TARGET,
      seq: input.seq,
      authorId: ME,
      clientMessageId: 'k:0',
      text: 'текст',
      replyToId: null,
      replySnapshot: null,
      threadRootId: null,
      fwdConversationId: SOURCE,
      fwdMessageId: 'src-1',
      fwdAuthorId: 'a-1',
      fwdThreadRootId: null,
      editedAt: null,
      deletedAt: null,
      obliterated: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never);
    mapper.toFreshDto.mockResolvedValue({} as never);
    await service.forward(
      ACTOR,
      TARGET,
      { sourceConversationId: SOURCE, messageIds: ['src-1'] },
      'key-tx',
    );
    expect(mapper.toFreshDto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tx: TX }),
    );
  });
});

describe('MessageActionsService.forward — упоминания комментария (#239)', () => {
  const ALICE = '33333333-3333-4333-8333-333333333333';
  it('токен комментария: снимок строки и payload несут упомянутых; копии — нет', async () => {
    const { service, messages, eventBus } = makeService();
    const body: ForwardMessagesBody = {
      sourceConversationId: SOURCE,
      messageIds: ['src-1'],
      comment: `Привет @[Алиса](user:${ALICE})`,
    };

    await service.forward(ACTOR, TARGET, body, 'fwd-key');

    // Строка комментария (fwd=null) — снимок упомянутых; копия пересылки — [].
    const commentInsert = messages.insertMessage.mock.calls.find(([draft]) => draft.fwd === null)!;
    expect(commentInsert[0]!.mentionedUserIds).toEqual([ALICE]);
    const copyInsert = messages.insertMessage.mock.calls.find(([draft]) => draft.fwd !== null)!;
    expect(copyInsert[0]!.mentionedUserIds).toEqual([]);

    // Событие отправки комментария несёт mentionedUserIds (fanout #100).
    const sent = eventBus.emit.mock.calls.filter(([, type]) => type === 'chat.message_sent');
    const commentEvent = sent.find(([, , payload]) => payload.forwarded === false)!;
    expect(commentEvent[2]!.mentionedUserIds).toEqual([ALICE]);
  });
});

describe('MessageActionsService.forward — канал проекта подчиняется проекту (AUD-003)', () => {
  const PROJECT = 'project-1';
  const body: ForwardMessagesBody = {
    sourceConversationId: SOURCE,
    messageIds: ['src-1'],
  };

  /** Беседы-приёмники: канал проекта (projectId) или тред канала. */
  function asProjectChannel(conversations: ReturnType<typeof makeService>['conversations']) {
    conversations.findTypeAndPermissions.mockResolvedValue({
      type: 'project_channel',
      projectId: PROJECT,
      // Матрица беседы разрешала бы пост любому участнику — проверка проекта
      // обязана перевесить это решение.
      permissions: { post: 'member' },
    });
  }

  it('корневая пересылка без права публикации проекта → 403, вставок и событий нет', async () => {
    const { service, conversations, projectChat, messages, eventBus } = makeService();
    asProjectChannel(conversations);
    projectChat.canPost.mockResolvedValue(false);

    await expect(service.forward(ACTOR, TARGET, body, 'fwd-key')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(projectChat.canPost).toHaveBeenCalledWith(PROJECT, ACTOR);
    expect(messages.insertMessage).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('корневая пересылка с правом публикации проекта → копии созданы', async () => {
    const { service, conversations, projectChat, messages } = makeService();
    asProjectChannel(conversations);
    projectChat.canPost.mockResolvedValue(true);

    const result = await service.forward(ACTOR, TARGET, body, 'fwd-key');
    expect(projectChat.canPost).toHaveBeenCalledWith(PROJECT, ACTOR);
    expect(messages.insertMessage).toHaveBeenCalled();
    expect(result.rows).toHaveLength(1);
  });

  it('пересылка в тред канала — canPost не применяется (треды открыты участникам)', async () => {
    const { service, conversations, projectChat, messages } = makeService();
    asProjectChannel(conversations);
    messages.findByIdInConversation.mockResolvedValue({ id: 'root-1', threadRootId: null });

    await service.forward(ACTOR, TARGET, { ...body, threadRootId: 'root-1' }, 'fwd-key');
    expect(projectChat.canPost).not.toHaveBeenCalled();
    expect(messages.insertMessage).toHaveBeenCalled();
  });

  it('группа: по-прежнему матрица беседы, canPost не вызывается', async () => {
    const { service, projectChat } = makeService();
    await service.forward(ACTOR, TARGET, body, 'fwd-key');
    expect(projectChat.canPost).not.toHaveBeenCalled();
  });
});

describe('MessageActionsService.forward — replay по идемпотентному ключу (аудит #317)', () => {
  const body: ForwardMessagesBody = {
    sourceConversationId: SOURCE,
    messageIds: ['src-1'],
    comment: 'вот это',
  };

  it('ключ уже зафиксирован в этой беседе → те же строки, без вставок и событий', async () => {
    // Arrange: crash-окно — блок пересылки уже закоммичен, Redis-реплея нет.
    const { service, messages, eventBus } = makeService();
    const committed = [
      { id: 'm-c', conversationId: TARGET, seq: 8n, clientMessageId: 'fwd-key:c' },
      { id: 'm-1', conversationId: TARGET, seq: 9n, clientMessageId: 'fwd-key:1' },
    ];
    messages.findExistingByKeys.mockResolvedValue(committed);

    // Act
    const result = await service.forward(ACTOR, TARGET, body, 'fwd-key');

    // Assert: ключи блока (комментарий + позиции копий), ответ — те же строки.
    expect(messages.findExistingByKeys).toHaveBeenCalledWith(
      ME,
      ['fwd-key:c', 'fwd-key:0', 'fwd-key:1'],
      TX,
    );
    expect(result.rows).toEqual(committed);
    expect(messages.allocateSeqs).not.toHaveBeenCalled();
    expect(messages.insertMessage).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('ключ занят в другой беседе → CONFLICT', async () => {
    const { service, messages } = makeService();
    messages.findExistingByKeys.mockResolvedValue([
      { id: 'm-c', conversationId: 'conv-other', seq: 3n, clientMessageId: 'fwd-key:c' },
    ]);

    await expect(service.forward(ACTOR, TARGET, body, 'fwd-key')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(messages.insertMessage).not.toHaveBeenCalled();
  });

  it('гонка: конкурент зафиксировался до INSERT → реплей его блока, не 500', async () => {
    const { service, messages, eventBus } = makeService();
    const raced = [{ id: 'm-c', conversationId: TARGET, seq: 8n, clientMessageId: 'fwd-key:c' }];
    messages.findExistingByKeys.mockResolvedValueOnce([]).mockResolvedValueOnce(raced);
    messages.insertMessage.mockResolvedValueOnce(null as never);

    const result = await service.forward(ACTOR, TARGET, body, 'fwd-key');

    expect(result.rows).toEqual(raced);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
