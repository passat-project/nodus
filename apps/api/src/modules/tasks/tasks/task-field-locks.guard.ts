import {
  changedLockKeys,
  ErrorCode,
  fieldLocksAfterChange,
  fieldLocksOf,
  lockActorOf,
  lockDenialOf,
  type FieldLocks,
  type LockablePatch,
  type LockableValues,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';

/**
 * Замок записи в писателе полей задачи (#496, Р4): проверка фактических
 * изменений и накопитель `lastChange`. Вынесено из `task-fields.writer.ts`
 * ради лимита строк (I5) — грамматика остаётся в контрактах, здесь только
 * превращение вердикта в 422.
 */

/** Значения полей строки для сравнения с патчем (замок — на изменении). */
export function lockValuesOf(row: {
  title: string;
  description: string;
  deadline: Date | null;
  priority: string;
  plannedMinutes: number | null;
  assigneeId: string;
  projectId: string | null;
  nodeId: string | null;
  customFields: unknown;
}): LockableValues {
  return {
    title: row.title,
    description: row.description,
    deadline: row.deadline?.toISOString() ?? null,
    priority: row.priority,
    plannedMinutes: row.plannedMinutes,
    assigneeId: row.assigneeId,
    projectId: row.projectId,
    nodeId: row.nodeId,
    customFields: (row.customFields as Record<string, unknown> | null) ?? {},
  };
}

/**
 * Закреплённый ключ, значение которого реально меняется, правит только
 * постановщик/`task.manage_any` с причиной или право `task.edit_locked` с
 * причиной; иначе 422 `FIELD_LOCKED`. Окно кнопки, которое снова просит
 * поле, пишет его мимо замка (В10) — `writableKeys`. Успех ручной правки
 * возвращает накопитель с `lastChange`; иначе `null` (колонка не пишется).
 */
export function assertFieldLocks(
  rawLocks: unknown,
  creatorId: string,
  values: LockableValues,
  actor: { id: string; permissions: readonly string[] },
  patch: LockablePatch,
  opts: { writableKeys?: ReadonlySet<string>; lockReason?: string },
): FieldLocks | null {
  const locks = fieldLocksOf(rawLocks);
  const keys = changedLockKeys(values, patch);
  const denial = lockDenialOf(locks, keys, lockActorOf(actor, creatorId), opts.lockReason, {
    ...(opts.writableKeys ? { writable: opts.writableKeys } : {}),
  });
  if (denial) {
    throw new DomainException(ErrorCode.FIELD_LOCKED, 'Field is locked', denial, 422);
  }
  const affected = keys.filter((key) => locks[key] !== undefined && !opts.writableKeys?.has(key));
  if (affected.length === 0) return null;
  return fieldLocksAfterChange(locks, affected, {
    at: new Date().toISOString(),
    by: actor.id,
    reason: opts.lockReason ?? '',
  });
}
