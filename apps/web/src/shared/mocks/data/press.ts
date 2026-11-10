import type {
  PressEntryView,
  PressRoundView,
  PressSubmitBody,
} from '@nodus/contracts';
import { pressEntryResultOf } from '@nodus/contracts';

import { REQUEST_ACK_TRANSITION_ID } from './request-workflow-document.js';
import { requestReviewStage, stageInProgress } from './task-stages.js';
import { userIds, userRef } from './users.js';
import { STANDARD_COMPLETE_TRANSITION_ID } from './workflows-documents.js';

/** Мок-состояние коллективных кнопок (#434): раунд на задачу. */

type MutableRound = Omit<
  PressRoundView,
  'pressed' | 'total' | 'myEntry' | 'canSubmit' | 'canWithdraw' | 'canReturn' | 'completed'
> & {
  completed: boolean;
};

const entry = (
  userId: string,
  order: number,
  state: PressEntryView['state'] = 'waiting',
): PressEntryView => ({
  userId,
  displayName: userRef(userId).displayName,
  order,
  state,
  pressedAt: state === 'pressed' ? new Date(Date.now() - order * 60_000).toISOString() : null,
  result:
    state === 'pressed'
      ? {
          text: 'Ознакомлен с материалами.',
          messageIds: [],
          fileCount: 0,
          minutes: null,
          date: new Date().toISOString().slice(0, 10),
        }
      : null,
  returnReason: null,
});

const base = {
  cycle: 1,
  order: 'parallel' as const,
  quorum: { kind: 'all' as const },
};

const allUsers = Object.values(userIds).filter((id) => id !== userIds.matorin);

function seedRounds(): Map<string, MutableRound> {
  return new Map<string, MutableRound>([
    [
      '30000000-0000-4000-8000-000000000017',
      {
        ...base,
        id: '70000000-0000-4000-8000-000000000014',
        stageId: stageInProgress.id,
        transitionId: STANDARD_COMPLETE_TRANSITION_ID,
        transitionName: 'Завершить',
        entries: [
          entry(userIds.klimovich, 0, 'waiting'),
          entry(userIds.polomar, 1, 'pressed'),
          entry(userIds.voronina, 2, 'pressed'),
          entry(userIds.karpovich, 3, 'pressed'),
          entry(userIds.akulich, 4, 'pressed'),
        ],
        completed: false,
      },
    ],
    [
      '30000000-0000-4000-8000-000000000018',
      {
        ...base,
        id: '70000000-0000-4000-8000-000000000015',
        stageId: requestReviewStage.id,
        transitionId: REQUEST_ACK_TRANSITION_ID,
        transitionName: 'Ознакомлен',
        entries: allUsers.map((userId, index) =>
          entry(userId, index, index < 6 && userId !== userIds.klimovich ? 'pressed' : 'waiting'),
        ),
        completed: false,
      },
    ],
    [
      '30000000-0000-4000-8000-000000000019',
      {
        ...base,
        id: '70000000-0000-4000-8000-000000000016',
        stageId: requestReviewStage.id,
        transitionId: REQUEST_ACK_TRANSITION_ID,
        transitionName: 'Ознакомлен',
        entries: allUsers.map((userId, index) =>
          entry(userId, index, userId === userIds.klimovich ? 'waiting' : 'pressed'),
        ),
        completed: false,
      },
    ],
  ]);
}

let rounds = seedRounds();

/** Только для тестов. */
export function resetPressDemo(): void {
  rounds = seedRounds();
}

function requiredCount(round: MutableRound): number {
  if (round.quorum.kind === 'any') return 1;
  if (round.quorum.kind === 'count') return round.quorum.count;
  return round.entries.filter((e) => e.state !== 'excluded').length;
}

function pressedCount(round: MutableRound): number {
  return round.entries.filter((e) => e.state === 'pressed').length;
}

function isQuorum(round: MutableRound): boolean {
  return pressedCount(round) >= requiredCount(round);
}

export function pressOf(
  taskId: string,
  viewerId: string,
  canManage = false,
): PressRoundView | null {
  const round = rounds.get(taskId);
  if (!round) return null;
  const myEntry = round.entries.find((e) => e.userId === viewerId) ?? null;
  const firstWaiting = [...round.entries]
    .filter((e) => e.state === 'waiting' || e.state === 'returned')
    .sort((a, b) => a.order - b.order)[0];
  const mineTurn = round.order === 'parallel' || firstWaiting?.userId === viewerId;
  return {
    ...round,
    total: round.entries.filter((e) => e.state !== 'excluded').length,
    pressed: pressedCount(round),
    myEntry,
    canSubmit:
      !round.completed &&
      mineTurn &&
      myEntry !== null &&
      (myEntry.state === 'waiting' || myEntry.state === 'returned'),
    canWithdraw: !round.completed && myEntry?.state === 'pressed',
    canReturn:
      canManage && !round.completed && round.entries.some((entry) => entry.state === 'pressed'),
    completed: round.completed,
    entries: round.entries.map((e) => ({ ...e })),
  };
}

export function submitPress(
  taskId: string,
  userId: string,
  body: PressSubmitBody,
): PressRoundView | null {
  const round = rounds.get(taskId);
  if (!round) return null;
  const target = round.entries.find((e) => e.userId === userId);
  if (!target || (target.state !== 'waiting' && target.state !== 'returned')) {
    return pressOf(taskId, userId);
  }
  target.state = 'pressed';
  target.pressedAt = new Date().toISOString();
  target.returnReason = null;
  target.result = pressEntryResultOf(body);
  round.completed = isQuorum(round);
  return pressOf(taskId, userId);
}

export function withdrawPress(taskId: string, userId: string): PressRoundView | null {
  const round = rounds.get(taskId);
  const target = round?.entries.find((e) => e.userId === userId);
  if (!round || !target || target.state !== 'pressed' || round.completed) {
    return pressOf(taskId, userId);
  }
  target.state = 'waiting';
  target.pressedAt = null;
  target.result = null;
  return pressOf(taskId, userId);
}

export function returnPress(
  taskId: string,
  userIdsToReturn: readonly string[],
  reason: string,
  viewerId: string,
): PressRoundView | null {
  const round = rounds.get(taskId);
  if (!round) return null;
  for (const userId of userIdsToReturn) {
    const target = round.entries.find((e) => e.userId === userId);
    if (!target || target.state !== 'pressed') continue;
    target.state = 'returned';
    target.returnReason = reason;
  }
  round.completed = isQuorum(round);
  return pressOf(taskId, viewerId);
}
