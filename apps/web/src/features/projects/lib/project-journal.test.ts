import { describe, expect, it } from 'vitest';
import type { ProjectListItem } from '@nodus/contracts';

import {
  matchesProjectFilters,
  primaryProjectRole,
  projectJournalParams,
  projectJournalUrl,
  type ProjectJournalFilters,
} from './project-journal.js';

function project(overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: 'p1',
    code: 'I001',
    name: 'Внедрение Revit',
    color: 'blue',
    manager: { id: 'u1', displayName: 'Иванов', avatarUrl: null },
    assistants: [],
    myMembership: { manager: true, assistant: false, participant: false, observer: false },
    visibility: 'open',
    status: 'active',
    type: { id: 't1', name: 'Договор' },
    portfolio: { id: 'g1', name: 'Метро' },
    client: null,
    membersCount: 1,
    membersPreview: [{ id: 'u1', displayName: 'Иванов', avatarUrl: null }],
    endDate: null,
    activityAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

const filters = (overrides: Partial<ProjectJournalFilters> = {}): ProjectJournalFilters => ({
  scope: 'all',
  ...overrides,
});

describe('primaryProjectRole', () => {
  it('сильнейший источник участия: руководитель → помощник → участник → наблюдатель', () => {
    expect(
      primaryProjectRole({
        manager: true,
        assistant: true,
        participant: true,
        observer: true,
      }),
    ).toBe('manager');
    expect(
      primaryProjectRole({
        manager: false,
        assistant: true,
        participant: true,
        observer: true,
      }),
    ).toBe('assistant');
    expect(
      primaryProjectRole({
        manager: false,
        assistant: false,
        participant: true,
        observer: true,
      }),
    ).toBe('participant');
    expect(
      primaryProjectRole({
        manager: false,
        assistant: false,
        participant: false,
        observer: true,
      }),
    ).toBe('observer');
    expect(
      primaryProjectRole({
        manager: false,
        assistant: false,
        participant: false,
        observer: false,
      }),
    ).toBeNull();
  });
});

describe('projectJournalParams / projectJournalUrl', () => {
  it('пустые значения не уходят в query, поиск тримится', () => {
    expect(projectJournalParams(filters({ search: '  рев  ' }))).toEqual({
      scope: 'all',
      search: 'рев',
      role: undefined,
      visibility: undefined,
      status: undefined,
      portfolioId: undefined,
      memberId: undefined,
      clientId: undefined,
    });
  });

  it('URL: limit всегда, курсор — только при наличии', () => {
    expect(projectJournalUrl({ scope: 'all', search: 'рев' }, null, 50)).toBe(
      '/projects?scope=all&search=%D1%80%D0%B5%D0%B2&limit=50',
    );
    expect(projectJournalUrl({ scope: 'mine' }, 'abc', 100)).toBe(
      '/projects?scope=mine&limit=100&cursor=abc',
    );
  });
});

describe('matchesProjectFilters (оптимистичная вставка)', () => {
  it('поиск по шифру и названию без регистра', () => {
    expect(matchesProjectFilters(project(), filters({ search: 'i001' }))).toBe(true);
    expect(matchesProjectFilters(project(), filters({ search: 'revit' }))).toBe(true);
    expect(matchesProjectFilters(project(), filters({ search: 'нет' }))).toBe(false);
  });

  it('видимость, статус, портфель, заказчик', () => {
    expect(matchesProjectFilters(project(), filters({ visibility: 'open' }))).toBe(true);
    expect(matchesProjectFilters(project(), filters({ visibility: 'secret' }))).toBe(false);
    expect(matchesProjectFilters(project(), filters({ status: 'archived' }))).toBe(false);
    expect(matchesProjectFilters(project(), filters({ portfolioId: 'g1' }))).toBe(true);
    expect(matchesProjectFilters(project(), filters({ portfolioId: 'g2' }))).toBe(false);
    expect(
      matchesProjectFilters(
        project({ client: { id: 'c1', name: 'Заказчик' } }),
        filters({ clientId: 'c1' }),
      ),
    ).toBe(true);
  });

  it('роль и scope=mine: не-участник в «Мои» не попадает', () => {
    expect(matchesProjectFilters(project(), filters({ role: 'manager' }))).toBe(true);
    expect(matchesProjectFilters(project(), filters({ role: 'participant' }))).toBe(false);
    const stranger = project({
      myMembership: { manager: false, assistant: false, participant: false, observer: false },
    });
    expect(matchesProjectFilters(stranger, filters({ scope: 'all' }))).toBe(true);
    expect(matchesProjectFilters(stranger, filters({ scope: 'mine' }))).toBe(false);
  });

  it('memberId — по превью состава (создатель/руководитель в нём всегда)', () => {
    expect(matchesProjectFilters(project(), filters({ memberId: 'u1' }))).toBe(true);
    expect(matchesProjectFilters(project(), filters({ memberId: 'u2' }))).toBe(false);
  });
});
