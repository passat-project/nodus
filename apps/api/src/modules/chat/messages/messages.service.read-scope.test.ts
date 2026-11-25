// Область квитанции чтения (#1026): лента и тред — разные адресаты
// WS-события, поэтому проверка отделена от общего контракта сервиса.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_EVENTS, ErrorCode } from '@nodus/contracts';

import { MessagesService } from './messages.service.js';

const CONV = 'conv-1';
const ME = 'me-1';
const ROOT = 'root-1';
const TX = 'tx-handle';

describe('MessagesService.readConversation: область квитанции (#1026)', () => {
  const repo = {
    findByIdInConversation: vi.fn(),
    advanceReadCursor: vi.fn(),
  };
  const conversations = {
    findMembership: vi.fn(),
    findLastSeq: vi.fn(),
  };
  const threadParticipants = { advanceReadCursor: vi.fn() };
  const threadReads = { advance: vi.fn() };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  let service: MessagesService;

  beforeEach(() => {
    vi.clearAllMocks();
    conversations.findMembership.mockResolvedValue({ userId: ME, role: 'member' });
    conversations.findLastSeq.mockResolvedValue(10n);
    repo.findByIdInConversation.mockResolvedValue({ id: ROOT, threadRootId: null });
    repo.advanceReadCursor.mockResolvedValue({ advanced: true, lastReadAt: null });
    threadReads.advance.mockResolvedValue(true);
    service = new MessagesService(
      repo as never,
      repo as never, // запись
      repo as never, // правка/удаление
      repo as never, // прочитанность
      {} as never, // вложения
      conversations as never,
      conversations as never, // участие
      conversations as never, // черновики
      {} as never, // mapper
      txRunner as never,
      eventBus as never,
      {} as never, // профили
      threadParticipants as never,
      threadReads as never,
      {} as never, // стикеры
      {} as never, // непрочитанные
      {} as never, // уведомления
      {} as never, // права на пост
    );
  });

  it('квитанция ленты несёт threadRootId=null — галки тредов не трогаются', async () => {
    const readAt = new Date('2026-09-25T10:00:00Z');
    repo.advanceReadCursor.mockResolvedValue({ advanced: true, lastReadAt: readAt });

    await service.readConversation(ME, CONV, 4);

    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_READ,
      {
        conversationId: CONV,
        userId: ME,
        upToSeq: 4,
        threadRootId: null,
        readAt: readAt.toISOString(),
      },
      { actorId: ME, aggregateType: 'conversation', aggregateId: CONV },
    );
  });

  it('квитанция треда несёт threadRootId треда и не двигает курсор ленты', async () => {
    const readAt = new Date('2026-09-25T11:00:00Z');
    repo.advanceReadCursor.mockResolvedValue({ advanced: true, lastReadAt: readAt });

    await service.readConversation(ME, CONV, 9, ROOT);

    expect(repo.advanceReadCursor).toHaveBeenCalledWith(CONV, ME, 9n, TX, { feed: false });
    expect(threadReads.advance).toHaveBeenCalledWith(ROOT, ME, 9n, TX);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_READ,
      {
        conversationId: CONV,
        userId: ME,
        upToSeq: 9,
        threadRootId: ROOT,
        readAt: readAt.toISOString(),
      },
      { actorId: ME, aggregateType: 'conversation', aggregateId: CONV },
    );
  });

  it('двинулся только watermark треда → событие всё равно уходит (курсор беседы стоял)', async () => {
    repo.advanceReadCursor.mockResolvedValue({ advanced: false, lastReadAt: null });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    try {
      await service.readConversation(ME, CONV, 9, ROOT);
    } finally {
      vi.useRealTimers();
    }

    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MESSAGE_READ,
      {
        conversationId: CONV,
        userId: ME,
        upToSeq: 9,
        threadRootId: ROOT,
        readAt: '2026-09-25T12:00:00.000Z',
      },
      { actorId: ME, aggregateType: 'conversation', aggregateId: CONV },
    );
  });

  it('тред не двинулся и беседа тоже → БЕЗ события', async () => {
    repo.advanceReadCursor.mockResolvedValue({ advanced: false, lastReadAt: null });
    threadReads.advance.mockResolvedValue(false);

    await service.readConversation(ME, CONV, 9, ROOT);

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('threadRootId не корень беседы → NOT_FOUND (чужая беседа/ответ)', async () => {
    repo.findByIdInConversation.mockResolvedValue(null);

    await expect(service.readConversation(ME, CONV, 9, ROOT)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(repo.advanceReadCursor).not.toHaveBeenCalled();
  });
});
