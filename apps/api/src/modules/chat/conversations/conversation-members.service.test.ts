// >300 строк — обоснование (I5): полный контракт состава беседы одного
// агрегата — матрица прав (#186), direct-гвард и точный лимит (#195),
// keyset-список с поиском; дробление по темам разорвало бы общий каркас моков.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { ErrorCode } from '@nodus/contracts';

import { encodeCursor } from '../../../core/pagination/cursor.util.js';
import { DEFAULT_CONVERSATION_PERMISSIONS } from '../permissions.js';
import { MAX_MEMBERS, ConversationMembersService } from './conversation-members.service.js';
import { ConversationsService } from './conversations.service.js';

/**
 * Матрица прав на новых действиях беседы (#186, I8): гварды API — по
 * conversationPermissionsSchema (дефолты: changeInfo=admin, addMembers=member,
 * removeMembers=admin, manageSettings=owner). Ключевые приёмочные: member
 * НЕ может сменить аватарку/название, НО может добавить участника.
 */

const CONV = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000012';
const MEMBER = '00000000-0000-4000-8000-000000000013';
const PEER = '00000000-0000-4000-8000-000000000014';
const PEER2 = '00000000-0000-4000-8000-000000000015';
const TX = 'tx-handle';

const JOINED = new Date('2026-09-01T09:00:00Z');

function makeRepo() {
  return {
    findMembership: vi.fn(),
    findTypeAndPermissions: vi.fn(async () => ({
      id: CONV,
      type: 'group',
      permissions: DEFAULT_CONVERSATION_PERMISSIONS,
    })),
    findListItem: vi.fn(),
    listMembers: vi.fn(async () => [
      membershipOf(OWNER, 'owner'),
      membershipOf(ADMIN, 'admin'),
      membershipOf(MEMBER, 'member'),
    ]),
    listMembersPage: vi.fn(
      async (): Promise<Array<{ userId: string; role: string; joinedAt: Date }>> => [],
    ),
    countMembers: vi.fn(async () => 3),
    lockConversation: vi.fn(),
    addMembers: vi.fn(async (_cid: string, ids: string[]) => ids),
    updateMemberRole: vi.fn(async () => true),
    removeMember: vi.fn(async () => true),
    updateTitle: vi.fn(async () => true),
    updateAvatar: vi.fn(async () => true),
  };
}

function membershipOf(userId: string, role: string) {
  return {
    conversationId: CONV,
    userId,
    role,
    lastReadSeq: 0n,
    lastReadAt: null,
    joinedAt: JOINED,
    pinned: false,
    muted: false,
    snoozed: false,
    hidden: false,
  };
}

function makeProfileReader() {
  return {
    findRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, displayName: `Имя ${id}`, avatarUrl: null })),
    ),
    searchByDisplayName: vi.fn(
      async (): Promise<Array<{ id: string; displayName: string; avatarUrl: string | null }>> => [],
    ),
    findMentionMatches: vi.fn(async () => []),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids),
  };
}

function makeServices() {
  const repo = makeRepo();
  repo.findListItem.mockResolvedValue({ id: CONV });
  const items = {
    toItem: vi.fn(async (row: { id: string }) => ({ id: row.id })),
    toItems: vi.fn(),
  };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const avatars = { process: vi.fn(async () => ({ fileId: 'file-1' })) };
  const userProfiles = makeProfileReader();
  const conversations = new ConversationsService(
    repo as never,
    repo as never, // запись беседы (ConversationsWriteRepository)
    repo as never, // запись участия (ConversationMembersRepository)
    repo as never, // черновики (ConversationDraftsRepository)
    items as never,
    txRunner as never,
    eventBus as never,
    avatars as never,
    userProfiles as never,
    { isDecider: vi.fn(async () => false) } as never,
  );
  const members = new ConversationMembersService(
    repo as never,
    repo as never, // запись беседы (ConversationsWriteRepository)
    repo as never, // запись участия (ConversationMembersRepository)
    items as never,
    txRunner as never,
    eventBus as never,
    userProfiles as never,
  );
  return { repo, eventBus, avatars, conversations, members, userProfiles };
}

describe('права матрицы: переименование и аватар (changeInfo=admin)', () => {
  let s: ReturnType<typeof makeServices>;
  beforeEach(() => {
    s = makeServices();
    vi.clearAllMocks();
  });

  it('member НЕ может переименовать — 403 FORBIDDEN', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    await expect(
      s.conversations.updateInfo(MEMBER, CONV, { title: 'Новое' }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('admin может переименовать — событие conversation_updated в той же tx', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(ADMIN, 'admin'));
    await s.conversations.updateInfo(ADMIN, CONV, { title: 'Новое' });
    expect(s.repo.updateTitle).toHaveBeenCalledWith(CONV, 'Новое', TX);
    expect(s.eventBus.emit).toHaveBeenCalledWith(
      TX,
      'chat.conversation_updated',
      { conversationId: CONV, title: 'Новое' },
      expect.anything(),
    );
  });

  it('member НЕ может сменить аватар — 403 (гвард до загрузки файла)', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    await expect(
      s.conversations.setAvatar(MEMBER, CONV, { name: 'a.png', size: 10 }, Readable.from([])),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(s.avatars.process).not.toHaveBeenCalled();
  });

  it('owner может сменить аватар — fileId деривата на беседе + событие', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(OWNER, 'owner'));
    await s.conversations.setAvatar(
      OWNER,
      CONV,
      { name: 'a.png', size: 10 },
      Readable.from([Buffer.from('x')]),
    );
    expect(s.avatars.process).toHaveBeenCalled();
    expect(s.repo.updateAvatar).toHaveBeenCalledWith(CONV, 'file-1', TX);
  });

  it('direct-беседу переименовать нельзя — VALIDATION_FAILED', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(OWNER, 'owner'));
    s.repo.findTypeAndPermissions.mockResolvedValue({
      id: CONV,
      type: 'direct',
      permissions: DEFAULT_CONVERSATION_PERMISSIONS,
    });
    await expect(s.conversations.updateInfo(OWNER, CONV, { title: 'Новое' })).rejects.toMatchObject(
      { code: ErrorCode.VALIDATION_FAILED },
    );
  });

  it('не-члену беседа не видна — 404 (не палить наличие)', async () => {
    s.repo.findMembership.mockResolvedValue(null);
    await expect(
      s.conversations.updateInfo(MEMBER, CONV, { title: 'Новое' }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('участники: addMembers=member, manageSettings=owner, removeMembers=admin', () => {
  let s: ReturnType<typeof makeServices>;
  beforeEach(() => {
    s = makeServices();
    vi.clearAllMocks();
  });

  it('member МОЖЕТ добавить участника (дефолт addMembers)', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    s.userProfiles.filterActiveUserIds.mockResolvedValue([PEER]);
    s.repo.findListItem.mockResolvedValue({ id: CONV });
    await s.members.add(MEMBER, CONV, { userIds: [PEER] });
    expect(s.repo.addMembers).toHaveBeenCalledWith(CONV, [PEER], TX);
    expect(s.eventBus.emit).toHaveBeenCalledWith(
      TX,
      'chat.member_added',
      { conversationId: CONV, userIds: [PEER], role: 'member' },
      expect.anything(),
    );
  });

  it('уже состоящих, неизвестных и уволенных пропускает молча (#343)', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    s.userProfiles.filterActiveUserIds.mockResolvedValue(['ghost-known']);
    s.repo.findListItem.mockResolvedValue({ id: CONV });
    await s.members.add(MEMBER, CONV, { userIds: [OWNER, 'ghost-known', 'unknown'] });
    expect(s.repo.addMembers).toHaveBeenCalledWith(CONV, ['ghost-known'], TX);
  });

  it('member НЕ может менять роли — manageSettings=owner', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    await expect(s.members.updateRole(MEMBER, CONV, PEER, { role: 'admin' })).rejects.toMatchObject(
      { code: ErrorCode.FORBIDDEN },
    );
  });

  it('owner назначает модератора — событие member_role_changed', async () => {
    s.repo.findMembership.mockImplementation(async (_cid: string, userId: string) =>
      userId === OWNER ? membershipOf(OWNER, 'owner') : membershipOf(PEER, 'member'),
    );
    await s.members.updateRole(OWNER, CONV, PEER, { role: 'admin' });
    expect(s.repo.updateMemberRole).toHaveBeenCalledWith(CONV, PEER, 'admin', TX);
    expect(s.eventBus.emit).toHaveBeenCalledWith(
      TX,
      'chat.member_role_changed',
      { conversationId: CONV, userId: PEER, role: 'admin', actorId: OWNER },
      expect.anything(),
    );
  });

  it('роль владельца не меняется никем', async () => {
    s.repo.findMembership.mockImplementation(async (_cid: string, userId: string) =>
      userId === OWNER ? membershipOf(OWNER, 'owner') : membershipOf(OWNER, 'owner'),
    );
    await expect(
      s.members.updateRole(OWNER, CONV, OWNER, { role: 'member' }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('admin исключает участника (иерархия admin > member)', async () => {
    s.repo.findMembership.mockImplementation(async (_cid: string, userId: string) =>
      userId === ADMIN ? membershipOf(ADMIN, 'admin') : membershipOf(PEER, 'member'),
    );
    await s.members.remove(ADMIN, CONV, PEER);
    expect(s.eventBus.emit).toHaveBeenCalledWith(
      TX,
      'chat.member_removed',
      { conversationId: CONV, userId: PEER, actorId: ADMIN },
      expect.anything(),
    );
  });

  it('admin НЕ может исключить модератора (равный ранг) — только владелец', async () => {
    s.repo.findMembership.mockImplementation(async (_cid: string, userId: string) =>
      userId === ADMIN ? membershipOf(ADMIN, 'admin') : membershipOf(PEER, 'admin'),
    );
    await expect(s.members.remove(ADMIN, CONV, PEER)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('владельца исключить нельзя', async () => {
    s.repo.findMembership.mockImplementation(async (_cid: string, userId: string) =>
      userId === ADMIN ? membershipOf(ADMIN, 'admin') : membershipOf(OWNER, 'owner'),
    );
    await expect(s.members.remove(ADMIN, CONV, OWNER)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('member НЕ может исключать — removeMembers=admin', async () => {
    s.repo.findMembership.mockImplementation(async (_cid: string, userId: string) =>
      userId === MEMBER ? membershipOf(MEMBER, 'member') : membershipOf(PEER, 'member'),
    );
    await expect(s.members.remove(MEMBER, CONV, PEER)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });
});

describe('мутации состава direct-беседы запрещены (#195: состав фиксирован сущностью)', () => {
  let s: ReturnType<typeof makeServices>;
  beforeEach(() => {
    s = makeServices();
    vi.clearAllMocks();
    s.repo.findTypeAndPermissions.mockResolvedValue({
      id: CONV,
      type: 'direct',
      permissions: DEFAULT_CONVERSATION_PERMISSIONS,
    });
  });

  it('add на direct → VALIDATION_FAILED, вставки и события нет', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    s.userProfiles.filterActiveUserIds.mockResolvedValue([PEER]);
    await expect(s.members.add(MEMBER, CONV, { userIds: [PEER] })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(s.repo.addMembers).not.toHaveBeenCalled();
    expect(s.eventBus.emit).not.toHaveBeenCalled();
  });

  it('updateRole на direct → VALIDATION_FAILED', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    await expect(s.members.updateRole(MEMBER, CONV, PEER, { role: 'admin' })).rejects.toMatchObject(
      { code: ErrorCode.VALIDATION_FAILED },
    );
  });

  it('remove на direct → VALIDATION_FAILED', async () => {
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    await expect(s.members.remove(MEMBER, CONV, PEER)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });
});

describe('участники: список (keyset-пагинация, поиск, видимость)', () => {
  let s: ReturnType<typeof makeServices>;
  beforeEach(() => {
    s = makeServices();
    vi.clearAllMocks();
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
  });

  it('страница с hasMore: обрезана до limit, nextCursor — последняя строка страницы с её рангом роли', async () => {
    s.repo.listMembersPage.mockResolvedValue([
      { userId: OWNER, role: 'owner', joinedAt: JOINED },
      { userId: ADMIN, role: 'admin', joinedAt: JOINED },
      { userId: MEMBER, role: 'member', joinedAt: JOINED },
    ]);
    const page = await s.members.list(MEMBER, CONV, { limit: 2 });
    expect(page.items.map((m) => m.user.id)).toEqual([OWNER, ADMIN]);
    expect(page.nextCursor).toBe(
      encodeCursor({ rank: 1, joinedAt: JOINED.toISOString(), userId: ADMIN }),
    );
  });

  it('конец списка (строк ≤ limit): nextCursor null', async () => {
    s.repo.listMembersPage.mockResolvedValue([{ userId: OWNER, role: 'owner', joinedAt: JOINED }]);
    const page = await s.members.list(MEMBER, CONV, { limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('курсор запроса декодируется и уходит в репозиторий', async () => {
    const cursor = encodeCursor({ rank: 1, joinedAt: JOINED.toISOString(), userId: ADMIN });
    await s.members.list(MEMBER, CONV, { limit: 50, cursor });
    expect(s.repo.listMembersPage).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({
        cursor: { rank: 1, joinedAt: JOINED.toISOString(), userId: ADMIN },
      }),
    );
  });

  it('битый курсор → VALIDATION_FAILED (нет молчаливого сброса на первую страницу)', async () => {
    await expect(
      s.members.list(MEMBER, CONV, { limit: 50, cursor: 'мусор' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('поиск: имена резолвит порт справочника, фильтр id уходит в SQL', async () => {
    s.userProfiles.searchByDisplayName.mockResolvedValue([
      { id: PEER, displayName: 'Имя', avatarUrl: null },
    ]);
    await s.members.list(MEMBER, CONV, { limit: 50, search: 'Имя' });
    expect(s.userProfiles.searchByDisplayName).toHaveBeenCalledWith('Имя', MAX_MEMBERS);
    expect(s.repo.listMembersPage).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ searchUserIds: [PEER] }),
    );
  });

  it('пустой результат поиска → фильтр пустого массива (ANY(∅) — пустая страница, не весь список)', async () => {
    s.userProfiles.searchByDisplayName.mockResolvedValue([]);
    const page = await s.members.list(MEMBER, CONV, { limit: 50, search: 'Нет таких' });
    expect(s.repo.listMembersPage).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ searchUserIds: [] }),
    );
    expect(page.items).toEqual([]);
  });

  it('не-члену список не виден — 404 (не палить существование)', async () => {
    s.repo.findMembership.mockResolvedValue(null);
    await expect(s.members.list(MEMBER, CONV, { limit: 50 })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe('участники: лимит 200 точный (перечёт в tx под блокировкой строки, #195)', () => {
  let s: ReturnType<typeof makeServices>;
  beforeEach(() => {
    s = makeServices();
    vi.clearAllMocks();
    s.repo.findMembership.mockResolvedValue(membershipOf(MEMBER, 'member'));
    s.userProfiles.filterActiveUserIds.mockResolvedValue([PEER, PEER2]);
    s.repo.listMembers.mockResolvedValue([]);
  });

  it('199 + 2 → CHAT_MEMBERS_LIMIT_REACHED: строка блокируется, вставки и события нет', async () => {
    s.repo.countMembers.mockResolvedValue(MAX_MEMBERS - 1);
    await expect(s.members.add(MEMBER, CONV, { userIds: [PEER, PEER2] })).rejects.toMatchObject({
      code: ErrorCode.CHAT_MEMBERS_LIMIT_REACHED,
    });
    expect(s.repo.lockConversation).toHaveBeenCalledWith(CONV, TX);
    expect(s.repo.addMembers).not.toHaveBeenCalled();
    expect(s.eventBus.emit).not.toHaveBeenCalled();
  });

  it('199 + 1 = 200 — граница проходит: вставка и событие в той же tx', async () => {
    s.repo.countMembers.mockResolvedValue(MAX_MEMBERS - 1);
    await s.members.add(MEMBER, CONV, { userIds: [PEER] });
    expect(s.repo.addMembers).toHaveBeenCalledWith(CONV, [PEER], TX);
    expect(s.eventBus.emit).toHaveBeenCalledWith(
      TX,
      'chat.member_added',
      expect.objectContaining({ userIds: [PEER] }),
      expect.anything(),
    );
  });
});
