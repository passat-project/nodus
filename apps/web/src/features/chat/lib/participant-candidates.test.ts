import { describe, expect, it } from 'vitest';
import type { UserListItem } from '@nodus/contracts';

import { chatParticipantCandidates } from './participant-candidates.js';

const person = (id: string, displayName: string, status: UserListItem['status']): UserListItem => ({
  id,
  displayName,
  status,
  avatarUrl: null,
  positionName: null,
  departmentName: null,
  email: `${id}@test.local`,
  managerId: null,
  departmentId: null,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
});

const users = [
  person('me', 'Я Сам', 'active'),
  person('active-1', 'Иванов Иван', 'active'),
  person('active-2', 'Петров Пётр', 'active'),
  person('fired', 'Анна Ночная', 'deactivated'),
];

describe('chatParticipantCandidates (#1013)', () => {
  it('уволенный не предлагается, даже по точному имени', () => {
    const result = chatParticipantCandidates(users, {
      meId: 'me',
      selectedIds: [],
      query: 'Анна',
    });
    expect(result).toEqual([]);
  });

  it('активные — по запросу, без себя и уже выбранных', () => {
    const result = chatParticipantCandidates(users, {
      meId: 'me',
      selectedIds: ['active-1'],
      query: 'Петров',
    });
    expect(result.map((u) => u.id)).toEqual(['active-2']);
  });

  it('пустой запрос — все активные, кроме себя и выбранных', () => {
    const result = chatParticipantCandidates(users, {
      meId: 'me',
      selectedIds: ['active-2'],
      query: '  ',
    });
    expect(result.map((u) => u.id)).toEqual(['active-1']);
  });
});
