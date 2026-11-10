import { describe, expect, it } from 'vitest';
import type { ProjectHistoryEntry, ProjectHistoryMember } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { projectHistoryTitle } from './project-history.js';

function entry(overrides: Partial<ProjectHistoryEntry> = {}): ProjectHistoryEntry {
  return {
    id: 'e-1',
    kind: 'participants_changed',
    actor: null,
    createdAt: '2026-11-10T10:00:00.000Z',
    fields: [],
    status: null,
    users: [],
    members: [],
    reason: null,
    visibility: null,
    automatic: false,
    name: null,
    ...overrides,
  };
}

function change(
  userId: string,
  action: ProjectHistoryMember['action'],
  from: ProjectHistoryMember['from'],
  to: ProjectHistoryMember['to'],
): ProjectHistoryMember {
  return {
    user: { id: userId, displayName: `Сотрудник ${userId}`, avatarUrl: null },
    action,
    from,
    to,
  };
}

const label = (field: string) => field;

describe('projectHistoryTitle (#699)', () => {
  it('создание, статус и поля — прежние строки', () => {
    expect(projectHistoryTitle(entry({ kind: 'created', name: 'Тендер' }), label)).toBe(
      `${ui.projects.history.created}: Тендер`,
    );
    expect(projectHistoryTitle(entry({ kind: 'status_changed', status: 'completed' }), label)).toBe(
      `${ui.projects.history.statusChanged}: ${ui.projects.status.completed}`,
    );
    expect(
      projectHistoryTitle(entry({ kind: 'updated', fields: ['name', 'endDate'] }), label),
    ).toBe(`${ui.projects.history.updated}: name, endDate`);
  });

  it('состав — действие и человек, без «было → стало»', () => {
    expect(
      projectHistoryTitle(
        entry({ reason: 'manual', members: [change('u1', 'added', null, 'member')] }),
        label,
      ),
    ).toBe(`${ui.projects.history.memberAdded}: Сотрудник u1`);
    expect(
      projectHistoryTitle(
        entry({ reason: 'manual', members: [change('u1', 'added', null, 'observer')] }),
        label,
      ),
    ).toBe(`${ui.projects.history.observerAdded}: Сотрудник u1`);
    expect(
      projectHistoryTitle(
        entry({ reason: 'manual', members: [change('u1', 'removed', 'member', null)] }),
        label,
      ),
    ).toBe(`${ui.projects.history.memberRemoved}: Сотрудник u1`);
    expect(
      projectHistoryTitle(
        entry({ reason: 'manual', members: [change('u1', 'role_changed', 'observer', 'member')] }),
        label,
      ),
    ).toBe(`${ui.projects.history.roleToMember}: Сотрудник u1`);
    expect(
      projectHistoryTitle(
        entry({ reason: 'manual', members: [change('u1', 'role_changed', 'member', 'observer')] }),
        label,
      ),
    ).toBe(`${ui.projects.history.roleToObserver}: Сотрудник u1`);
  });

  it('несколько действий — группы по формулировке (#699)', () => {
    expect(
      projectHistoryTitle(
        entry({
          reason: 'manual',
          members: [
            change('u1', 'added', null, 'member'),
            change('u2', 'added', null, 'member'),
            change('u3', 'removed', 'observer', null),
          ],
        }),
        label,
      ),
    ).toBe(
      `${ui.projects.history.memberAdded}: Сотрудник u1, Сотрудник u2; ${ui.projects.history.observerRemoved}: Сотрудник u3`,
    );
  });

  it('вступление и уход — строками человека', () => {
    expect(
      projectHistoryTitle(
        entry({ reason: 'join', members: [change('u1', 'added', null, 'observer')] }),
        label,
      ),
    ).toBe(`${ui.projects.history.joined}: Сотрудник u1`);
    expect(
      projectHistoryTitle(
        entry({ reason: 'leave', members: [change('u1', 'removed', 'observer', null)] }),
        label,
      ),
    ).toBe(`${ui.projects.history.left}: Сотрудник u1`);
  });

  it('очистка при смене видимости — системная строка с причиной и счётом', () => {
    expect(
      projectHistoryTitle(
        entry({
          reason: 'visibility',
          visibility: 'secret',
          members: [
            change('u1', 'removed', 'task', null),
            change('u2', 'removed', 'observer', null),
          ],
        }),
        label,
      ),
    ).toBe(ui.projects.history.rosterClearedSecret.replace('{count}', '2'));
    expect(
      projectHistoryTitle(
        entry({
          reason: 'visibility',
          visibility: 'open',
          members: [change('u1', 'removed', 'member', null)],
        }),
        label,
      ),
    ).toBe(ui.projects.history.rosterClearedOpen.replace('{count}', '1'));
  });

  it('старая запись без семантики — прежняя сводка по людям', () => {
    expect(
      projectHistoryTitle(
        entry({
          users: [
            { id: 'u1', displayName: 'Иванов', avatarUrl: null },
            { id: 'u2', displayName: 'Петров', avatarUrl: null },
          ],
        }),
        label,
      ),
    ).toBe(`${ui.projects.history.participantsChanged}: Иванов, Петров`);
    expect(projectHistoryTitle(entry(), label)).toBe(ui.projects.history.participantsChanged);
  });
});
