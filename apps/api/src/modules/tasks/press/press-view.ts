import {
  pressConfigSchema,
  pressEntryResultSchema,
  type PressRoundView,
} from '@nodus/contracts';

import type { PressRoundRow } from './press.repository.js';

/**
 * Строка БД → `PressRoundView` (I4: карточка сразу видит прогресс и права
 * смотрящего). Правила совпадают с моком #434: `total` без снятых, `pressed`
 * только нажавшие, «по очереди» — первый ждущий по порядку.
 */
export function pressRoundViewOf(
  round: PressRoundRow,
  viewerId: string,
  displayNameOf: (userId: string) => string,
  canManage = false,
): PressRoundView {
  const config = pressConfigSchema.parse(round.config);
  const entries = round.entries.map((entry) => ({
    userId: entry.userId,
    displayName: displayNameOf(entry.userId),
    order: entry.order,
    state: entry.state as PressRoundView['entries'][number]['state'],
    pressedAt: entry.pressedAt?.toISOString() ?? null,
    result: entry.result ? pressEntryResultSchema.parse(entry.result) : null,
    returnReason: entry.returnReason,
  }));
  const myEntry = entries.find((entry) => entry.userId === viewerId) ?? null;
  const active = entries.filter((entry) => entry.state !== 'excluded');
  const firstWaiting = entries
    .filter((entry) => entry.state === 'waiting' || entry.state === 'returned')
    .sort((a, b) => a.order - b.order)[0];
  const completed = round.completedAt !== null;
  const mineTurn = config.order === 'parallel' || firstWaiting?.userId === viewerId;

  return {
    id: round.id,
    stageId: round.stageId,
    transitionId: round.transitionId,
    transitionName: round.transitionName,
    cycle: round.cycle,
    total: active.length,
    pressed: active.filter((entry) => entry.state === 'pressed').length,
    order: config.order,
    quorum: config.quorum,
    entries,
    myEntry,
    canSubmit:
      !completed &&
      mineTurn &&
      myEntry !== null &&
      (myEntry.state === 'waiting' || myEntry.state === 'returned'),
    canWithdraw: !completed && myEntry?.state === 'pressed',
    canReturn:
      canManage &&
      !completed &&
      entries.some((entry) => entry.state === 'pressed'),
    completed,
  };
}
