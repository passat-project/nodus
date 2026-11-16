import { describe, expect, it } from 'vitest';
import type { ConversationListItem, ConversationMember } from '@nodus/contracts';

import { memberRowActions } from './conversation-members.js';

/** Матрица по умолчанию (changeInfo=admin, removeMembers=admin, manageSettings=owner). */
const conversation = {
  id: 'c1',
  myRole: 'owner',
  permissions: {
    changeInfo: 'admin',
    addMembers: 'member',
    removeMembers: 'admin',
    post: 'member',
    manageSettings: 'owner',
  },
} as ConversationListItem;

function member(id: string, role: ConversationMember['role']): ConversationMember {
  return {
    user: { id, displayName: `Имя ${id}`, avatarUrl: null },
    role,
    joinedAt: '2026-09-01T09:00:00Z',
  };
}

describe('memberRowActions (#186): меню строки участника по правам матрицы', () => {
  it('владелец видит все действия над модератором (снять модератора, удалить)', () => {
    const actions = memberRowActions({
      conversation,
      member: member('u-admin', 'admin'),
      meId: 'me',
    });
    expect(actions).toEqual({ makeAdmin: false, demoteAdmin: true, remove: true });
  });

  it('владелец назначает модератора из участника', () => {
    const actions = memberRowActions({ conversation, member: member('u-1', 'member'), meId: 'me' });
    expect(actions).toEqual({ makeAdmin: true, demoteAdmin: false, remove: true });
  });

  it('модератор (дефолт removeMembers=admin): удаляет участника, но не трогает модераторов и не назначает ролей (manageSettings=owner)', () => {
    const asAdmin = { ...conversation, myRole: 'admin' } as ConversationListItem;
    expect(
      memberRowActions({ conversation: asAdmin, member: member('u-1', 'member'), meId: 'me' }),
    ).toEqual({ makeAdmin: false, demoteAdmin: false, remove: true });
    expect(
      memberRowActions({ conversation: asAdmin, member: member('u-2', 'admin'), meId: 'me' }),
    ).toEqual({ makeAdmin: false, demoteAdmin: false, remove: false });
  });

  it('рядовой участник не видит меню вовсе', () => {
    const asMember = { ...conversation, myRole: 'member' } as ConversationListItem;
    const actions = memberRowActions({
      conversation: asMember,
      member: member('u-1', 'member'),
      meId: 'me',
    });
    expect(actions).toEqual({ makeAdmin: false, demoteAdmin: false, remove: false });
  });

  it('своя строка и строка владельца — без действий', () => {
    expect(memberRowActions({ conversation, member: member('me', 'owner'), meId: 'me' })).toEqual({
      makeAdmin: false,
      demoteAdmin: false,
      remove: false,
    });
    expect(
      memberRowActions({ conversation, member: member('u-owner', 'owner'), meId: 'me' }),
    ).toEqual({ makeAdmin: false, demoteAdmin: false, remove: false });
  });

  it('канал проекта: ручного исключения нет — состав ведёт проект (AUD-003)', () => {
    const asChannel = { ...conversation, type: 'project_channel' } as ConversationListItem;
    expect(
      memberRowActions({ conversation: asChannel, member: member('u-1', 'member'), meId: 'me' }),
    ).toEqual({ makeAdmin: true, demoteAdmin: false, remove: false });
  });
});
