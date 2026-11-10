import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { ProjectReaderProvider } from './project-reader.provider.js';

function make(enabled = true) {
  const projects = {};
  const participants = {
    rolesByProject: vi.fn(async () => [
      { projectId: 'p-1', source: 'task' },
      { projectId: 'p-1', source: 'member' },
      { projectId: 'p-2', source: 'observer' },
      { projectId: 'p-3', source: 'manager' },
      { projectId: 'p-4', source: 'assistant' },
    ]),
    userIdsBySources: vi.fn(async () => ['u-1']),
  };
  const nodes = {};
  const featureFlags = { isEnabled: vi.fn(async () => enabled) };
  const provider = new ProjectReaderProvider(
    projects as never,
    participants as never,
    nodes as never,
    featureFlags as never,
  );
  return { provider, participants };
}

describe('ProjectReaderProvider — роли решающих (#433)', () => {
  it('rolesIn: источник → бизнес-роль, participant = task|member', async () => {
    const { provider } = make();
    await expect(provider.rolesIn('u-1', ['p-1', 'p-2', 'p-3', 'p-4'])).resolves.toEqual({
      'p-1': ['participant'],
      'p-2': ['observer'],
      'p-3': ['manager'],
      'p-4': ['assistant'],
    });
  });

  it('rolesIn без проектов и при выключенном модуле — пусто', async () => {
    const { provider } = make();
    await expect(provider.rolesIn('u-1', [])).resolves.toEqual({});
    const disabled = make(false);
    await expect(disabled.provider.rolesIn('u-1', ['p-1'])).resolves.toEqual({});
  });

  it('usersWithRoles: роли разворачиваются в источники проекции', async () => {
    const { provider, participants } = make();
    await expect(provider.usersWithRoles('p-1', ['manager', 'participant'])).resolves.toEqual([
      'u-1',
    ]);
    expect(participants.userIdsBySources).toHaveBeenCalledWith(undefined, 'p-1', [
      'manager',
      'task',
      'member',
    ]);
  });

  it('usersWithRoles: пустой список ролей и выключенный модуль — пусто', async () => {
    const { provider } = make();
    await expect(provider.usersWithRoles('p-1', [])).resolves.toEqual([]);
    const disabled = make(false);
    await expect(disabled.provider.usersWithRoles('p-1', ['manager'])).resolves.toEqual([]);
  });
});

describe('ProjectReaderProvider — состав задачи секретного проекта (#674)', () => {
  function makeMembers(visibility: 'open' | 'secret', status: 'active' | 'archived' = 'active') {
    const projects = {
      findById: vi.fn(async () => ({ id: 'p-1', visibility, status })),
    };
    const participants = {
      rowsOfProject: vi.fn(async () => [
        {
          projectId: 'p-1',
          userId: 'manager-1',
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: 'p-1',
          userId: 'member-1',
          source: 'member',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: 'p-1',
          userId: 'observer-1',
          source: 'observer',
          observerKind: 'invited',
          createdAt: new Date(),
        },
      ]),
    };
    const featureFlags = { isEnabled: vi.fn(async () => true) };
    return new ProjectReaderProvider(
      projects as never,
      participants as never,
      {} as never,
      featureFlags as never,
    );
  }

  it('открытый проект — любые сотрудники', async () => {
    await expect(
      makeMembers('open').assertMembersAllowed('p-1', ['outsider']),
    ).resolves.toBeUndefined();
  });

  it('секретный — руководство и участники проходят, наблюдатель и посторонний — нет', async () => {
    const provider = makeMembers('secret');
    await expect(
      provider.assertMembersAllowed('p-1', ['manager-1', 'member-1']),
    ).resolves.toBeUndefined();
    await expect(
      provider.assertMembersAllowed('p-1', ['observer-1', 'outsider']),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_TASK_MEMBERS_INVALID,
      details: { projectId: 'p-1', userIds: ['observer-1', 'outsider'] },
    });
  });

  it('архивный проект — отказ как раньше', async () => {
    await expect(
      makeMembers('secret', 'archived').assertMembersAllowed('p-1', ['manager-1']),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});
