import type {
  FieldLocks,
  FormLock,
  LockActor,
  LockablePatch,
  LockStamp,
  TaskFieldLock,
  TaskListItem,
} from '@nodus/contracts';
import {
  customFieldIdOfKey,
  customFieldKey,
  ErrorCode,
  lockAllowed,
  lockKeysOfPatch,
  mergeLocks,
  Permission,
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
 * Демо-пользователь — с правом `task.manage_any` («как постановщик») и БЕЗ
 * `task.edit_locked`: замок «никто» он видит только для чтения, замок
 * «постановщик» правит через окно причины.
 * // #496 бэкенд снимает: накопитель и проверка — task-fields.writer (Пакет 2).
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

function actorOf(task: Pick<TaskListItem, 'creator'>): LockActor {
  const has = (permission: string) => currentAuthUser.permissions.includes(permission as never);
  return {
    isCreator: task.creator.id === currentAuthUser.id,
    canManageAny: has(Permission.TASK_MANAGE_ANY),
    canEditLocked: has(Permission.TASK_EDIT_LOCKED),
  };
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
  const locked = keys.filter((key) => locks[key] && !writable?.has(key));
  if (locked.length === 0) return null;
  const actor = actorOf(task);
  for (const key of locked) {
    const verdict = lockAllowed(locks[key]!.editors, actor, reason);
    if (!verdict.allowed) {
      return HttpResponse.json(
        {
          code: ErrorCode.FIELD_LOCKED,
          message: 'Field is locked',
          details: { keys: locked, reason: verdict.reason },
        },
        { status: 422 },
      );
    }
  }
  const at = new Date().toISOString();
  const next: FieldLocks = { ...locks };
  for (const key of locked) {
    next[key] = {
      ...next[key]!,
      lastChange: { at, by: currentAuthUser.id, reason: reason!.trim() },
    };
  }
  store.set(task.id, next);
  return null;
}

/** Текущие значения записи для сравнения с патчем (замок — только на
 *  реально меняющемся значении, как FORMULA_CELL_LOCKED). */
export interface LockableValues {
  title: string;
  description: string;
  deadline: string | null;
  priority: string;
  plannedMinutes: number | null;
  assigneeId: string | null;
  projectId: string | null;
  nodeId: string | null;
  customFields: Readonly<Record<string, unknown>>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Ключи замка, значение которых патч действительно меняет (карта Р4). */
export function changedLockKeys(current: LockableValues, patch: LockablePatch): string[] {
  return lockKeysOfPatch(patch).filter((key) => {
    switch (key) {
      case 'title':
      case 'description':
      case 'deadline':
      case 'priority':
      case 'plannedMinutes':
        return !same(patch[key], current[key]);
      case 'assignee':
        return !same(patch.assigneeId, current.assigneeId);
      case 'project':
        return (
          (patch.projectId !== undefined && !same(patch.projectId, current.projectId)) ||
          (patch.nodeId !== undefined && !same(patch.nodeId, current.nodeId))
        );
      default: {
        const fieldId = customFieldIdOfKey(key);
        return (
          fieldId !== null && !same(patch.customFields?.[fieldId], current.customFields[fieldId])
        );
      }
    }
  });
}

/** Замки детали (Р10): `canEdit` — правило замка без учёта причины. */
export function fieldLocksDto(task: Pick<TaskListItem, 'id' | 'creator'>): TaskFieldLock[] {
  const actor = actorOf(task);
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
