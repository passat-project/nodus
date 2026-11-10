import { describe, expect, it } from 'vitest';
import type { ProjectMember } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import {
  groupProjectMembers,
  manualMembershipKind,
  memberRemovalLabel,
  taskParticipantIds,
} from './project-members.js';

function member(
  userId: string,
  source: ProjectMember['source'],
  observerKind: ProjectMember['observerKind'] = null,
): ProjectMember {
  return {
    user: { id: userId, displayName: `Сотрудник ${userId}`, avatarUrl: null },
    source,
    observerKind,
    joinedAt: '2026-10-29T10:00:00.000Z',
  };
}

describe('groupProjectMembers', () => {
  it('группирует строки-источники по сотруднику и сортирует источники', () => {
    const groups = groupProjectMembers([
      member('u1', 'task'),
      member('u2', 'manager'),
      member('u1', 'manager'),
      member('u2', 'assistant'),
      member('u1', 'observer', 'joined'),
    ]);

    expect(groups).toHaveLength(2);
    const first = groups.find((group) => group.user.id === 'u1');
    expect(first?.sources).toEqual(['manager', 'task', 'observer']);
    expect(first?.observerKind).toBe('joined');
    const second = groups.find((group) => group.user.id === 'u2');
    expect(second?.sources).toEqual(['manager', 'assistant']);
    expect(second?.observerKind).toBeNull();
  });

  it('пустой состав — пустой список', () => {
    expect(groupProjectMembers([])).toEqual([]);
  });
});

describe('manualMembershipKind', () => {
  it('ручной вид — member/observer; руководство и задачи не снимаются', () => {
    const [managerGroup] = groupProjectMembers([member('u1', 'manager')]);
    expect(manualMembershipKind(managerGroup!)).toBeNull();

    const [taskGroup] = groupProjectMembers([member('u1', 'task')]);
    expect(manualMembershipKind(taskGroup!)).toBeNull();

    const [manualMember] = groupProjectMembers([member('u1', 'member')]);
    expect(manualMembershipKind(manualMember!)).toBe('member');

    const [observer] = groupProjectMembers([member('u1', 'observer', 'invited')]);
    expect(manualMembershipKind(observer!)).toBe('observer');
  });

  it('member важнее observer у одного человека', () => {
    const [group] = groupProjectMembers([
      member('u1', 'observer', 'invited'),
      member('u1', 'member'),
    ]);
    expect(manualMembershipKind(group!)).toBe('member');
  });
});

describe('memberRemovalLabel (#714)', () => {
  it('подпись называет реально снимаемую роль', () => {
    expect(memberRemovalLabel('observer')).toBe(ui.projects.removeObserver);
    expect(memberRemovalLabel('member')).toBe(ui.projects.removeMember);
  });
});

describe('taskParticipantIds (#714)', () => {
  it('участники из задач — для исключения из пикера наблюдателей', () => {
    const rows = [member('u1', 'task'), member('u2', 'observer', 'invited'), member('u3', 'task')];
    expect(taskParticipantIds(rows)).toEqual(['u1', 'u3']);
  });
});
