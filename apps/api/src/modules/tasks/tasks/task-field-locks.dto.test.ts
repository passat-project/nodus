import { describe, expect, it } from 'vitest';
import type { AuthUser, FieldLocks, UserRef } from '@nodus/contracts';

import { detailFieldLocks, detailLockKeys, detailLockUserIds } from './task-field-locks.dto.js';

/**
 * Замки детали задачи (#496, Р10): только ключи текущего типа, ссылки на
 * постановщика/автора правки и `canEdit` по правилу замка без причины.
 */

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FIELD = '11111111-1111-4111-8111-111111111111';
const TRANSITION = '22222222-2222-4222-8222-222222222222';

const LOCKS: FieldLocks = {
  deadline: {
    editors: 'owners',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: ALICE,
    source: { kind: 'creation' },
    lastChange: {
      at: '2026-11-09T10:00:00.000Z',
      by: BOB,
      reason: 'сдвиг срока',
    },
  },
  [`cf.${FIELD}`]: {
    editors: 'none',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: ALICE,
    source: { kind: 'transition', transitionId: TRANSITION, name: 'Выдать в печать' },
  },
  'cf.33333333-3333-4333-8333-333333333333': {
    editors: 'none',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: ALICE,
    source: { kind: 'creation' },
  },
  unknown: {
    editors: 'none',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: null,
    source: { kind: 'creation' },
  },
};

const user = (id: string, permissions: string[] = []): AuthUser =>
  ({ id, displayName: id, permissions }) as unknown as AuthUser;

const refOf = (id: string): UserRef => ({ id, displayName: id, avatarUrl: null });

describe('detailLockKeys: ключи текущего типа (Р10)', () => {
  it('системные и привязанные атрибуты; чужие и неизвестные — нет', () => {
    const keys = detailLockKeys(LOCKS, new Set([FIELD]));
    expect(keys).toEqual(['deadline', `cf.${FIELD}`]);
  });

  it('битое значение колонки — замков нет', () => {
    expect(detailLockKeys({ deadline: { editors: 'all' } }, new Set())).toEqual([]);
  });
});

describe('detailLockUserIds', () => {
  it('постановщик и автор последней правки', () => {
    expect(detailLockUserIds(LOCKS, ['deadline', `cf.${FIELD}`])).toEqual([ALICE, BOB, ALICE]);
  });
});

describe('detailFieldLocks: canEdit', () => {
  it('замок «постановщик» — постановщику можно, остальным нет; «никто» — никому', () => {
    const keys = detailLockKeys(LOCKS, new Set([FIELD]));
    const asCreator = detailFieldLocks(LOCKS, keys, user(ALICE), ALICE, refOf);
    expect(asCreator.find((lock) => lock.key === 'deadline')?.canEdit).toBe(true);
    expect(asCreator.find((lock) => lock.key === `cf.${FIELD}`)?.canEdit).toBe(false);

    const asOther = detailFieldLocks(LOCKS, keys, user(BOB), ALICE, refOf);
    expect(asOther.find((lock) => lock.key === 'deadline')?.canEdit).toBe(false);
  });

  it('право task.edit_locked — canEdit у любого замка', () => {
    const keys = detailLockKeys(LOCKS, new Set([FIELD]));
    const asForce = detailFieldLocks(LOCKS, keys, user(BOB, ['task.edit_locked']), ALICE, refOf);
    expect(asForce.every((lock) => lock.canEdit)).toBe(true);
  });

  it('ссылки и след правки — объектами', () => {
    const [lock] = detailFieldLocks(LOCKS, ['deadline'], user(BOB), ALICE, refOf);
    expect(lock?.lockedBy).toMatchObject({ id: ALICE });
    expect(lock?.lastChange).toMatchObject({ by: { id: BOB }, reason: 'сдвиг срока' });
    expect(lock?.source).toEqual({ kind: 'creation' });
  });
});
