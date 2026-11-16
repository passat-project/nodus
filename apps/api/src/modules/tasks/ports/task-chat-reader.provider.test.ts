import { describe, expect, it, vi } from 'vitest';

import { TaskChatReaderProvider } from './task-chat-reader.provider.js';

const TASK = {
  id: 'task-1',
  workflowId: 'wf-1',
  stageId: 'stage-1',
  systemState: 'active',
  creatorId: 'creator',
  assigneeId: 'assignee',
  projectId: null,
  confidential: false,
  customFields: {},
};

function make(visible: boolean, decider: boolean) {
  const reads = { isVisible: vi.fn(async () => visible) };
  const deciderTasks = { findTask: vi.fn(async () => TASK) };
  const viewers = {
    resolve: vi.fn(async () => ({
      id: 'u1',
      permissions: [],
      subordinateIds: [],
      visibleProjectIds: [],
      hiddenProjectIds: [],
    })),
  };
  const deciders = { isDeciderNow: vi.fn(async () => decider) };
  const provider = new TaskChatReaderProvider(
    reads as never,
    deciderTasks as never,
    viewers as never,
    deciders as never,
  );
  return { provider, reads, deciders };
}

describe('TaskChatReaderProvider.roster — ответственный всегда в составе (#741)', () => {
  it('собирает постановщика, ответственного и участников без дублей', async () => {
    const reads = {
      findLiveRoster: vi.fn(async () => ({
        creatorId: 'creator',
        assigneeId: 'assignee',
        participants: [
          { userId: 'creator', role: 'coexecutor' },
          { userId: 'observer', role: 'observer' },
        ],
      })),
    };
    const provider = new TaskChatReaderProvider(
      reads as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const roster = await provider.roster('task-1');
    // Исключение блока перехода (#741, `previousAssigneeId`) опирается на этот
    // инвариант: ответственный в составе есть всегда, поэтому нажавший
    // «Передать» был участником беседы в момент нажатия.
    expect(roster?.members.map((member) => member.userId)).toEqual([
      'creator',
      'assignee',
      'observer',
    ]);
  });
});

describe('TaskChatReaderProvider.isDecider (#433)', () => {
  it('решающий видимой задачи — true', async () => {
    const { provider, reads } = make(true, true);
    await expect(provider.isDecider('task-1', 'u1')).resolves.toBe(true);
    expect(reads.isVisible).toHaveBeenCalled();
  });

  it('невидимая задача — false даже при совпадении источника', async () => {
    const { provider, deciders } = make(false, true);
    await expect(provider.isDecider('task-1', 'u1')).resolves.toBe(false);
    expect(deciders.isDeciderNow).not.toHaveBeenCalled();
  });

  it('видимая, но не решающий — false', async () => {
    const { provider } = make(true, false);
    await expect(provider.isDecider('task-1', 'u1')).resolves.toBe(false);
  });
});
