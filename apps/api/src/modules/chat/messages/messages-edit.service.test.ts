// Правка сообщений (#188): текст + состав вложений — выделено из общего
// контракта сервиса (I5: файл тестов > 500 строк недопустим).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_EVENTS, ErrorCode } from '@nodus/contracts';

import { MessagesService } from './messages.service.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';

const CONV = 'conv-1';
const ME = 'me-1';
const PEER = 'peer-1';
const TX = 'tx-handle';

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  const now = new Date('2026-09-24T09:00:00Z');
  return {
    id: 'msg-1',
    conversationId: CONV,
    seq: 3n,
    authorId: ME,
    clientMessageId: 'key-1',
    text: 'Текст',
    kind: 'text',
    payload: null,
    replyToId: null,
    replySnapshot: null,
    threadRootId: null,
    fwdConversationId: null,
    fwdMessageId: null,
    fwdAuthorId: null,
    fwdThreadRootId: null,
    editedAt: null,
    deletedAt: null,
    obliterated: false,
    urgent: false,
    mentionedUserIds: null,
    everMentionedUserIds: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMember(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    conversationId: CONV,
    userId: PEER,
    role: 'member',
    lastReadSeq: 0n,
    lastReadAt: null,
    lastFeedReadSeq: 0n,
    lastFeedReadAt: null,
    joinedAt: new Date('2026-09-24T09:00:00Z'),
    pinned: false,
    muted: false,
    snoozed: false,
    hidden: false,
    ...overrides,
  };
}

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'msg-1',
    id: 'att-1',
    name: 'a.png',
    kind: 'file',
    // mime в БД NOT NULL — витринная классификация (#211) читает его.
    mime: 'application/pdf',
    sortOrder: 0,
    ...overrides,
  };
}

describe('MessagesService.edit (#188: текст + состав вложений)', () => {
  const repo = {
    findByIdInConversation: vi.fn(),
    attachmentsFor: vi.fn(),
    updateEditText: vi.fn(),
    listPage: vi.fn(),
  };
  const attachmentsRepo = {
    syncMessageAttachments: vi.fn(),
    renameMessageAttachments: vi.fn(),
  };
  const conversations = {
    findMembership: vi.fn(),
    listMembers: vi.fn(),
    listMembersPage: vi.fn(async (_c: string, opts: { searchUserIds?: string[] }) =>
      (opts.searchUserIds ?? []).map((userId) => ({
        userId,
        role: 'member',
        joinedAt: new Date(),
      })),
    ),
  };
  const mapper = { toDtos: vi.fn(), toFreshDto: vi.fn() };
  const threadParticipants = { upsert: vi.fn(), delete: vi.fn() };
  const stickersRepo = { findSticker: vi.fn() };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const userProfiles = {
    findRefs: vi.fn(),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids),
  };
  let service: MessagesService;

  beforeEach(() => {
    vi.clearAllMocks();
    conversations.findMembership.mockResolvedValue(makeMember({ userId: ME, role: 'owner' }));
    conversations.listMembers.mockResolvedValue([]);
    service = new MessagesService(
      repo as never,
      repo as never, // запись (MessagesWriteRepository)
      repo as never, // правка/удаление (MessagesLifecycleRepository)
      repo as never, // прочитанность (MessagesReadStateRepository)
      attachmentsRepo as never,
      conversations as never,
      conversations as never, // запись участия (ConversationMembersRepository)
      conversations as never, // черновики (ConversationDraftsRepository)
      mapper as never,
      txRunner as never,
      eventBus as never,
      userProfiles as never,
      threadParticipants as never,
      { advance: vi.fn(), readCursorsFor: vi.fn() } as never,
      stickersRepo as never,
      {
        applyMessageSent: vi.fn(async () => {}),
        applyMessageEdited: vi.fn(async () => {}),
        applyMessageDeleted: vi.fn(async () => {}),
        applyForwardCopies: vi.fn(async () => {}),
      } as never,
      { enqueue: vi.fn(async () => undefined) } as never,
      { canPost: vi.fn(async () => true) } as never,
    );
  });

  it('сообщение не найдено / не автор → NOT_FOUND / FORBIDDEN без UPDATE', async () => {
    repo.findByIdInConversation.mockResolvedValue(null);
    await expect(service.edit(ME, CONV, 'msg-1', { text: 'Новый' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Message not found',
    });
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ authorId: PEER }));
    await expect(service.edit(ME, CONV, 'msg-1', { text: 'Новый' })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Only author can modify this message',
    });
    expect(repo.updateEditText).not.toHaveBeenCalled();
  });

  it('пересланную копию ЧУЖОГО текста не правит даже переславший (#111 → #1072)', async () => {
    repo.findByIdInConversation.mockResolvedValue(
      makeMessage({ fwdMessageId: 'src-msg', fwdConversationId: 'src-conv', fwdAuthorId: PEER }),
    );
    await expect(
      service.edit(ME, CONV, 'msg-1', { text: 'переписанное чужое' }),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Forwarded messages cannot be edited',
    });
    expect(repo.updateEditText).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('пересланную копию СВОЕГО текста автор пересылки правит (#1072)', async () => {
    repo.findByIdInConversation.mockResolvedValue(
      makeMessage({ fwdMessageId: 'src-msg', fwdConversationId: 'src-conv', fwdAuthorId: ME }),
    );
    repo.updateEditText.mockResolvedValue(
      makeMessage({
        text: 'поправленное своё',
        editedAt: new Date('2026-11-27T13:00:00Z'),
        fwdMessageId: 'src-msg',
        fwdConversationId: 'src-conv',
        fwdAuthorId: ME,
      }),
    );

    const result = await service.edit(ME, CONV, 'msg-1', { text: 'поправленное своё' });

    expect(repo.updateEditText).toHaveBeenCalledWith(
      CONV,
      'msg-1',
      ME,
      'поправленное своё',
      [],
      [],
      TX,
    );
    expect(result.message.text).toBe('поправленное своё');
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_EDITED,
      expect.objectContaining({ text: 'поправленное своё' }),
      expect.anything(),
    );
  });

  it('блок перехода (#380) не правится: журнал и чат не расходятся', async () => {
    repo.findByIdInConversation.mockResolvedValue(
      makeMessage({ kind: 'task_transition', payload: { kind: 'task_transition' } }),
    );
    await expect(service.edit(ME, CONV, 'msg-1', { text: 'переписано' })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Only text messages can be edited',
    });
    expect(repo.updateEditText).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('тот же текст → без UPDATE и без события', async () => {
    const message = makeMessage({ text: 'Привет' });
    repo.findByIdInConversation.mockResolvedValue(message);

    const result = await service.edit(ME, CONV, 'msg-1', { text: 'Привет' });

    expect(repo.updateEditText).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(result.message).toEqual(message);
  });

  it('другой текст → updateEditText + MESSAGE_EDITED с editedAt', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: 'Привет' }));
    repo.updateEditText.mockResolvedValue(
      makeMessage({ text: 'Новый', editedAt: new Date('2026-09-24T13:00:00Z') }),
    );

    const result = await service.edit(ME, CONV, 'msg-1', { text: 'Новый' });

    expect(repo.updateEditText).toHaveBeenCalledWith(CONV, 'msg-1', ME, 'Новый', [], [], TX);
    expect(result.message.text).toBe('Новый');
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_EDITED,
      expect.objectContaining({
        editedAt: '2026-09-24T13:00:00.000Z',
        authorId: ME,
        text: 'Новый',
        seq: 3,
      }),
      expect.anything(),
    );
  });

  /** #239: правка с новым упоминанием — событие несёт дифф множеств
   *  (previous = накопительное ever, не снапшот версии). */
  it('упоминание в новой версии → MESSAGE_EDITED с mentioned/previous (#239)', async () => {
    const NEW = '77777777-7777-7777-7777-777777777777';
    const PREV = '88888888-8888-8888-8888-888888888888';
    // токен — реальная грамматика: @[текст](user:uuid)
    const wire = `Привет @[Алиса](user:${NEW})`;
    repo.findByIdInConversation.mockResolvedValue(
      makeMessage({ text: 'Привет', mentionedUserIds: [PREV], everMentionedUserIds: [PREV] }),
    );
    repo.updateEditText.mockResolvedValue(
      makeMessage({ text: wire, editedAt: new Date('2026-10-07T13:00:00Z') }),
    );
    conversations.listMembersPage.mockResolvedValue([
      { userId: NEW, role: 'member', joinedAt: new Date() },
    ]);

    await service.edit(ME, CONV, 'msg-1', { text: wire });

    // Снапшот строки — новое множество; ever — объединение; событие —
    // текущее + накопительное (дифф считает notifications).
    expect(repo.updateEditText).toHaveBeenCalledWith(
      CONV,
      'msg-1',
      ME,
      wire,
      [NEW],
      [PREV, NEW],
      TX,
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_EDITED,
      expect.objectContaining({
        mentionedUserIds: [NEW],
        previousMentionedUserIds: [PREV],
      }),
      expect.anything(),
    );
  });

  /** Вердикт владельца 10.10: отправлено @Все → правка заменила на личный
   *  тэг Анны — Анна получает ВЫСШИЙ (личный тэг ≠ broadcast в истории). */
  it('«@Все → @Анна»: ever с сентинелом, previous только личные + флаг all', async () => {
    const ALICE = '77777777-7777-7777-7777-777777777777';
    const wire = `Важно: @[Анна](user:${ALICE})`;
    // Состояние после отправки @Все: снапшот expanded, ever = ['all'].
    repo.findByIdInConversation.mockResolvedValue(
      makeMessage({
        text: 'Важно: @[Все](user:all)',
        mentionedUserIds: [ALICE, '99999999-9999-9999-9999-999999999999'],
        everMentionedUserIds: ['all'],
      }),
    );
    repo.updateEditText.mockResolvedValue(
      makeMessage({ text: wire, editedAt: new Date('2026-10-10T19:00:00Z') }),
    );
    conversations.listMembersPage.mockResolvedValue([
      { userId: ALICE, role: 'member', joinedAt: new Date() },
    ]);

    await service.edit(ME, CONV, 'msg-1', { text: wire });

    // ever накапливает сентинел + личный тэг; payload несёт флаги диффа.
    expect(repo.updateEditText).toHaveBeenCalledWith(
      CONV,
      'msg-1',
      ME,
      wire,
      [ALICE],
      ['all', ALICE],
      TX,
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_EDITED,
      expect.objectContaining({
        mentionedUserIds: [ALICE],
        previousMentionedUserIds: [],
        previousMentionedAll: true,
        directMentionedUserIds: [ALICE],
      }),
      expect.anything(),
    );
  });

  /** #239 (критерий приёмки): убрали упоминание в правке N, вернули в
   *  правке N+1 — повторного пинга НЕТ: previous = накопительное ever. */
  it('убрали-вернули того же в следующей правке → previous из ever, пинга нет', async () => {
    const ALICE = '77777777-7777-7777-7777-777777777777';
    const wire = `Вернула @[Алиса](user:${ALICE})`;
    // Состояние ПОСЛЕ правки-удаления: снапшот пуст, ever помнит Алису.
    repo.findByIdInConversation.mockResolvedValue(
      makeMessage({
        text: 'Убрала упоминание',
        mentionedUserIds: [],
        everMentionedUserIds: [ALICE],
      }),
    );
    repo.updateEditText.mockResolvedValue(
      makeMessage({ text: wire, editedAt: new Date('2026-10-07T13:05:00Z') }),
    );
    conversations.listMembersPage.mockResolvedValue([
      { userId: ALICE, role: 'member', joinedAt: new Date() },
    ]);

    await service.edit(ME, CONV, 'msg-1', { text: wire });

    expect(repo.updateEditText).toHaveBeenCalledWith(CONV, 'msg-1', ME, wire, [ALICE], [ALICE], TX);
    // previousMentionedUserIds = [ALICE] → в notifications её НЕТ в диффе
    // (mentioned − previous пуст) — повторного chat.mention не будет.
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_EDITED,
      expect.objectContaining({
        mentionedUserIds: [ALICE],
        previousMentionedUserIds: [ALICE],
      }),
      expect.anything(),
    );
  });

  it('правка только текста: состав не трогается (attachmentIds отсутствует)', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: 'Привет' }));
    repo.updateEditText.mockResolvedValue(
      makeMessage({ text: 'Новый', editedAt: new Date('2026-10-04T12:02:00Z') }),
    );

    await service.edit(ME, CONV, 'msg-1', { text: 'Новый' });

    expect(repo.attachmentsFor).not.toHaveBeenCalled();
    expect(attachmentsRepo.syncMessageAttachments).not.toHaveBeenCalled();
  });

  it('смена состава: sync вызван, реальная смена → editedAt + событие', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: 'Файлы' }));
    repo.attachmentsFor
      .mockResolvedValueOnce([attachmentRow({ id: 'att-1', name: 'старое.png' })])
      .mockResolvedValueOnce([attachmentRow({ id: 'att-2', name: 'новое.png' })]);
    repo.updateEditText.mockResolvedValue(
      makeMessage({ text: 'Файлы', editedAt: new Date('2026-10-04T12:00:00Z') }),
    );

    await service.edit(ME, CONV, 'msg-1', { text: 'Файлы', attachmentIds: ['att-2'] });

    expect(attachmentsRepo.syncMessageAttachments).toHaveBeenCalledWith('msg-1', ['att-2'], ME, TX);
    expect(attachmentsRepo.renameMessageAttachments).not.toHaveBeenCalled();
    expect(repo.updateEditText).toHaveBeenCalledWith(CONV, 'msg-1', ME, 'Файлы', [], [], TX);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('идентичный состав без переименований → без события (идемпотентность)', async () => {
    const rows = [attachmentRow(), attachmentRow({ id: 'att-2', name: 'b.png', sortOrder: 1 })];
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: 'Файлы' }));
    repo.attachmentsFor.mockResolvedValue(rows);

    await service.edit(ME, CONV, 'msg-1', { text: 'Файлы', attachmentIds: ['att-1', 'att-2'] });

    expect(attachmentsRepo.syncMessageAttachments).toHaveBeenCalledWith(
      'msg-1',
      ['att-1', 'att-2'],
      ME,
      TX,
    );
    expect(repo.updateEditText).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('переименование: имена применены, editedAt + событие при реальной смене', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: 'Файлы' }));
    repo.attachmentsFor
      .mockResolvedValueOnce([attachmentRow({ name: 'старое.png' })])
      .mockResolvedValueOnce([attachmentRow({ name: 'новое имя.png' })]);
    repo.updateEditText.mockResolvedValue(
      makeMessage({ text: 'Файлы', editedAt: new Date('2026-10-04T12:01:00Z') }),
    );

    await service.edit(ME, CONV, 'msg-1', {
      text: 'Файлы',
      attachmentRenames: [{ id: 'att-1', name: 'новое имя.png' }],
    });

    expect(attachmentsRepo.renameMessageAttachments).toHaveBeenCalledWith(
      'msg-1',
      [{ id: 'att-1', name: 'новое имя.png' }],
      TX,
    );
    expect(attachmentsRepo.syncMessageAttachments).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('переименование без смены имени → без события', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: 'Файлы' }));
    repo.attachmentsFor.mockResolvedValue([attachmentRow({ name: 'то же.png' })]);

    await service.edit(ME, CONV, 'msg-1', {
      text: 'Файлы',
      attachmentRenames: [{ id: 'att-1', name: 'то же.png' }],
    });

    expect(repo.updateEditText).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('стикер-сообщение составом не правится (стикер неделим, #143)', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: '' }));
    repo.attachmentsFor.mockResolvedValue([attachmentRow({ kind: 'sticker' })]);

    await expect(
      service.edit(ME, CONV, 'msg-1', { text: '', attachmentIds: [] }),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Sticker messages cannot be edited',
    });
    expect(attachmentsRepo.syncMessageAttachments).not.toHaveBeenCalled();
  });

  it('стикер не переименовывается (гвард на attachmentRenames, #143)', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: '' }));
    repo.attachmentsFor.mockResolvedValue([attachmentRow({ kind: 'sticker' })]);

    await expect(
      service.edit(ME, CONV, 'msg-1', {
        text: '',
        attachmentRenames: [{ id: 'att-1', name: 'переименованный стикер' }],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Sticker messages cannot be edited',
    });
    expect(attachmentsRepo.renameMessageAttachments).not.toHaveBeenCalled();
  });

  it('непустота (security #188): мусорный id не оставляет сообщение пустым', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: '' }));
    // До правки — одно вложение; после синхронизации список пуст (id не
    // клеймится) → валидационная ошибка, транзакция откатится.
    repo.attachmentsFor
      .mockResolvedValueOnce([attachmentRow({ name: 'файл.png' })])
      .mockResolvedValueOnce([]);

    await expect(
      service.edit(ME, CONV, 'msg-1', { text: '', attachmentIds: ['unknown-uuid'] }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Message must have text or attachments',
    });
    expect(repo.updateEditText).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('текст с обрезкой до пустого не проходит непустоту', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ text: 'старый текст' }));
    repo.attachmentsFor.mockResolvedValue([]);

    await expect(
      service.edit(ME, CONV, 'msg-1', { text: '   ', attachmentIds: [] }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});
