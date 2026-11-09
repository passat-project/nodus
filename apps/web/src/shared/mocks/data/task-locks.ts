import type {
  FieldLocks,
  FormLock,
  LockStamp,
  TaskFieldLock,
  TaskListItem,
} from '@nodus/contracts';
import {
  customFieldKey,
  ErrorCode,
  fieldLocksAfterChange,
  lockActorOf,
  lockAllowed,
  lockDenialOf,
  mergeLocks,
} from '@nodus/contracts';
import { HttpResponse } from 'msw';

import { isoAgo } from './dates.js';
import { fieldIds } from './field-ids.js';
import { tid } from './task-item-factory.js';
import { currentAuthUser, userIds, userRef } from './users.js';

/**
 * Замки задач мок-мира (#496, Р4) — зеркало колонки `tasks.field_locks`:
 * окно создания и выполненная кнопка закрепляют поля, ручная правка
 * закреплённого — 422 FIELD_LOCKED (`locked` / `owners_only` /
 * `reason_required`), правка владельцем с причиной пишет `lastChange`.
 * Проверки и сравнение патча — общие чистые хелперы контрактов
 * (`lockDenialOf`, `changedLockKeys`): мок и сервер решают одинаково.
 * Демо-пользователь — с правом `task.manage_any` («как постановщик») и БЕЗ
 * `task.edit_locked`: замок «никто» он видит только для чтения, замок
 * «постановщик» правит через окно причины.
 */

const ISSUE_PRINT_ID = '30000000-0000-4000-8000-999999999999';

const store = new Map<string, FieldLocks>([
  [
    tid(630),
    {
      [customFieldKey(fieldIds.issueFile)]: {
        editors: 'none',
        lockedAt: isoAgo(1, 15, 20),
        lockedBy: userIds.klimovich,
        source: { kind: 'transition', transitionId: ISSUE_PRINT_ID, name: 'Выдать в печать' },
      },
      deadline: {
        editors: 'owners',
        lockedAt: isoAgo(3, 10, 0),
        lockedBy: userIds.klimovich,
        source: { kind: 'creation' },
      },
    },
  ],
]);

export function taskLocks(taskId: string): FieldLocks {
  return store.get(taskId) ?? {};
}

/** Поставить замки окна (создание или кнопка): строже побеждает (I-L8). */
export function addTaskLocks(taskId: string, locks: readonly FormLock[], stamp: LockStamp): void {
  if (locks.length === 0) return;
  store.set(taskId, mergeLocks(taskLocks(taskId), locks, stamp));
}

/**
 * Ручная правка закреплённых ключей (Р4). `keys` — ключи, значение которых
 * МЕНЯЕТСЯ; `writable` — ключи окна кнопки, которые окно пишет мимо замка
 * (В10). Отказ — готовый ответ 422; успех — `lastChange` у затронутых.
 */
export function lockDenial(
  task: Pick<TaskListItem, 'id' | 'creator'>,
  keys: readonly string[],
  reason: string | undefined,
  writable?: ReadonlySet<string>,
): Response | null {
  const locks = taskLocks(task.id);
  const actor = lockActorOf(currentAuthUser, task.creator.id);
  const denial = lockDenialOf(locks, keys, actor, reason, {
    ...(writable ? { writable } : {}),
  });
  if (denial) {
    return HttpResponse.json(
      { code: ErrorCode.FIELD_LOCKED, message: 'Field is locked', details: denial },
      { status: 422 },
    );
  }
  const affected = keys.filter((key) => locks[key] !== undefined && !writable?.has(key));
  store.set(
    task.id,
    fieldLocksAfterChange(locks, affected, {
      at: new Date().toISOString(),
      by: currentAuthUser.id,
      reason: reason ?? '',
    }),
  );
  return null;
}

export { changedLockKeys } from '@nodus/contracts';

/** Замки детали (Р10): `canEdit` — правило замка без учёта причины. */
export function fieldLocksDto(task: Pick<TaskListItem, 'id' | 'creator'>): TaskFieldLock[] {
  const actor = lockActorOf(currentAuthUser, task.creator.id);
  return Object.entries(taskLocks(task.id)).map(([key, entry]) => ({
    key,
    editors: entry.editors,
    lockedAt: entry.lockedAt,
    lockedBy: entry.lockedBy ? userRef(entry.lockedBy) : null,
    source: entry.source,
    ...(entry.lastChange
      ? {
          lastChange: {
            at: entry.lastChange.at,
            by: userRef(entry.lastChange.by),
            reason: entry.lastChange.reason,
          },
        }
      : {}),
    canEdit: lockAllowed(entry.editors, actor, null, { ignoreReason: true }).allowed,
  }));
}
