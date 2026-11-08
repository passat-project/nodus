import type { AuthUser, TaskFieldLock, UserRef } from '@nodus/contracts';
import {
  customFieldIdOfKey,
  fieldLocksOf,
  isLockableKey,
  lockActorOf,
  lockAllowed,
} from '@nodus/contracts';

/**
 * Замки записи в детали задачи (#496, Р10) — чистые сборщики DTO: какие
 * ключи показывать, кого гидратировать ссылками и как считать `canEdit`.
 * Вынесено из `tasks-query.service.ts` ради лимита строк (I5).
 */

/** Ключи замков детали: системные из канона и атрибуты ТЕКУЩЕГО типа;
 *  замок атрибута, снятого с типа, не показывается (ключ уже мёртв). */
export function detailLockKeys(raw: unknown, boundFieldIds: ReadonlySet<string>): string[] {
  return Object.keys(fieldLocksOf(raw)).filter((key) => {
    if (!isLockableKey(key)) return false;
    const fieldId = customFieldIdOfKey(key);
    return fieldId === null || boundFieldIds.has(fieldId);
  });
}

/** Кого гидратировать ссылками: постановщик замка и автор последней правки. */
export function detailLockUserIds(raw: unknown, keys: readonly string[]): string[] {
  const locks = fieldLocksOf(raw);
  return keys.flatMap((key) => {
    const entry = locks[key]!;
    return [entry.lockedBy, entry.lastChange?.by].filter((id): id is string => Boolean(id));
  });
}

/** Замки в форме детали (Р10): `canEdit` — правило замка без причины. */
export function detailFieldLocks(
  raw: unknown,
  keys: readonly string[],
  actor: AuthUser,
  creatorId: string,
  ref: (id: string) => UserRef,
): TaskFieldLock[] {
  const locks = fieldLocksOf(raw);
  const actorOf = lockActorOf(actor, creatorId);
  return keys.map((key) => {
    const entry = locks[key]!;
    return {
      key,
      editors: entry.editors,
      lockedAt: entry.lockedAt,
      lockedBy: entry.lockedBy ? ref(entry.lockedBy) : null,
      source: entry.source,
      ...(entry.lastChange
        ? {
            lastChange: {
              at: entry.lastChange.at,
              by: ref(entry.lastChange.by),
              reason: entry.lastChange.reason,
            },
          }
        : {}),
      canEdit: lockAllowed(entry.editors, actorOf, null, { ignoreReason: true }).allowed,
    };
  });
}
