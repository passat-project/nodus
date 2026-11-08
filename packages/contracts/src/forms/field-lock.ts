import { z } from 'zod';

import { customFieldIdOfKey, customFieldKey } from '../custom-fields/custom-field-key.js';
import { userRefSchema } from '../directory/user-ref.schema.js';

/**
 * Замок записи (#496, Р4; В5/В9/В10/В13/В14/В20): окно создания или окно
 * кнопки закрепляет поля задачи — после создания или нажатия руками их не
 * поменять. Замок живёт на задаче (`tasks.field_locks`) и сам не снимается:
 * ни возвратом по маршруту, ни сменой типа. Закреплённое вручную правит
 * «никто» или «постановщик, с причиной»; исполнитель — никогда, своих прав у
 * руководства нет; форс-мажор — право роли `task.edit_locked` с причиной.
 * Окно кнопки, которое снова просит поле, менять его может (В10).
 *
 * Общая грамматика (исключение patterns.md): сервер на всех путях записи,
 * моки и веб (`canEdit`, окно причины) обязаны решать одинаково.
 */

/** Системные поля задачи, которые можно закрепить; плюс `cf.<uuid>`
 *  атрибута типа. Чек-лист, подзадачи, итог, время и вложения — не поля
 *  записи и не закрепляются. */
export const LOCKABLE_SYSTEM_KEYS = [
  'title',
  'description',
  'deadline',
  'assignee',
  'priority',
  'project',
  'plannedMinutes',
  'coexecutors',
  'observers',
] as const;
export const lockableSystemKeySchema = z.enum(LOCKABLE_SYSTEM_KEYS);
export type LockableSystemKey = z.infer<typeof lockableSystemKeySchema>;

/** Кто правит закреплённое вручную: никто / постановщик (с причиной). */
export const lockEditorsSchema = z.enum(['none', 'owners']);
export type LockEditors = z.infer<typeof lockEditorsSchema>;

export const FIELD_LOCK_LIMITS = {
  /** Замков в одном окне. */
  locks: 30,
  reasonMin: 3,
  reason: 500,
} as const;

/** Закрепляемый ли ключ: системный из списка или атрибут `cf.<uuid>`. */
export function isLockableKey(key: string): boolean {
  return (
    (LOCKABLE_SYSTEM_KEYS as readonly string[]).includes(key) || customFieldIdOfKey(key) !== null
  );
}

/** Замок в окне. Годность ключа проверяет публикация
 *  (`form_lock_key_invalid`, `custom_field_unknown`, `form_lock_field_not_in_type`). */
export const formLockSchema = z
  .object({
    key: z.string().min(1).max(64),
    editors: lockEditorsSchema,
  })
  .strict();
export type FormLock = z.infer<typeof formLockSchema>;

export const formLocksSchema = z
  .array(formLockSchema)
  .max(FIELD_LOCK_LIMITS.locks)
  .refine((locks) => new Set(locks.map((lock) => lock.key)).size === locks.length, {
    message: 'duplicate lock',
  });
export type FormLocks = z.infer<typeof formLocksSchema>;

/** Причина ручной правки закреплённого поля. */
export const lockReasonSchema = z
  .string()
  .trim()
  .min(FIELD_LOCK_LIMITS.reasonMin)
  .max(FIELD_LOCK_LIMITS.reason);

/** Query-параметр причины у DELETE (участник, формула ячейки). */
export const lockReasonQuerySchema = z.object({ lockReason: lockReasonSchema.optional() }).strict();
export type LockReasonQuery = z.infer<typeof lockReasonQuerySchema>;

/** Откуда замок: окно создания или выполненная кнопка (её имя на момент
 *  нажатия — для подписи «Закреплено после «Выдать в печать»»). */
export const fieldLockSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('creation') }).strict(),
  z
    .object({
      kind: z.literal('transition'),
      transitionId: z.uuid(),
      name: z.string().min(1).max(32),
    })
    .strict(),
]);
export type FieldLockSource = z.infer<typeof fieldLockSourceSchema>;

/** Последняя ручная правка закреплённого (владельцем или по праву). */
export const fieldLockChangeSchema = z
  .object({
    at: z.iso.datetime(),
    by: z.uuid(),
    reason: z.string().min(1).max(FIELD_LOCK_LIMITS.reason),
  })
  .strict();

export const fieldLockEntrySchema = z
  .object({
    editors: lockEditorsSchema,
    lockedAt: z.iso.datetime(),
    lockedBy: z.uuid().nullable(),
    source: fieldLockSourceSchema,
    lastChange: fieldLockChangeSchema.optional(),
  })
  .strict();
export type FieldLockEntry = z.infer<typeof fieldLockEntrySchema>;

/** Накопитель замков задачи — колонка `tasks.field_locks` (C29). */
export const fieldLocksSchema = z.record(z.string().min(1).max(64), fieldLockEntrySchema);
export type FieldLocks = z.infer<typeof fieldLocksSchema>;

/** Терпимое чтение накопителя: битое значение — замков нет. */
export function fieldLocksOf(raw: unknown): FieldLocks {
  const parsed = fieldLocksSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export interface LockStamp {
  lockedAt: string;
  lockedBy: string | null;
  source: FieldLockSource;
}

const STRICTNESS: Record<LockEditors, number> = { owners: 1, none: 2 };

/**
 * Слияние замков (I-L8): строже побеждает — `none` поверх `owners`
 * заменяет запись целиком; равный или мягче — остаётся прежняя запись.
 * Повтор идемпотентен: та же карта возвращается тем же объектом.
 */
export function mergeLocks(
  current: FieldLocks,
  locks: readonly FormLock[],
  stamp: LockStamp,
): FieldLocks {
  let next: FieldLocks | null = null;
  for (const lock of locks) {
    const existing = (next ?? current)[lock.key];
    if (existing && STRICTNESS[lock.editors] <= STRICTNESS[existing.editors]) continue;
    next ??= { ...current };
    next[lock.key] = {
      editors: lock.editors,
      lockedAt: stamp.lockedAt,
      lockedBy: stamp.lockedBy,
      source: stamp.source,
    };
  }
  return next ?? current;
}

/** Замки окна создания (Р4): из эффективной формы типа, включая скрытые
 *  слоты с пресетом — их значение замок и защищает. */
export function buildCreationLocks(
  form: { locks?: readonly FormLock[] | null },
  actorId: string,
  now: string,
): FieldLocks {
  return mergeLocks({}, form.locks ?? [], {
    lockedAt: now,
    lockedBy: actorId,
    source: { kind: 'creation' },
  });
}

export interface LockActor {
  /** Постановщик задачи (`creator_id`). Роли от `TaskProjectRights.supplement`
   *  сюда не годятся: руководство проекта своих прав не имеет (В20). */
  isCreator: boolean;
  /** Право роли `task.manage_any` — «как постановщик». */
  canManageAny: boolean;
  /** Право роли `task.edit_locked` — форс-мажор, любой замок с причиной. */
  canEditLocked: boolean;
}

/** Почему ручная правка закреплённого отклонена — `details.reason` 422 `FIELD_LOCKED`. */
export const lockDenialSchema = z.enum(['locked', 'owners_only', 'reason_required']);
export type LockDenial = z.infer<typeof lockDenialSchema>;

export type LockVerdict = { allowed: true } | { allowed: false; reason: LockDenial };

/**
 * Можно ли вручную поменять закреплённое (Р4). Право пути (`canEdit`)
 * проверяет вызывающий ДО замка: право снимает только замок, не видимость.
 * `ignoreReason` — проверка без причины (флаг `canEdit` детали, Р10).
 */
export function lockAllowed(
  editors: LockEditors,
  actor: LockActor,
  reason?: string | null,
  opts: { ignoreReason?: boolean } = {},
): LockVerdict {
  const hasReason =
    opts.ignoreReason === true ||
    (typeof reason === 'string' && lockReasonSchema.safeParse(reason).success);
  if (actor.canEditLocked) {
    return hasReason ? { allowed: true } : { allowed: false, reason: 'reason_required' };
  }
  if (editors === 'none') return { allowed: false, reason: 'locked' };
  if (!actor.isCreator && !actor.canManageAny) return { allowed: false, reason: 'owners_only' };
  return hasReason ? { allowed: true } : { allowed: false, reason: 'reason_required' };
}

/** Ключ замка участников по роли. */
export function participantLockKey(role: 'coexecutor' | 'observer'): LockableSystemKey {
  return role === 'coexecutor' ? 'coexecutors' : 'observers';
}

/** Поля патча задачи, которые может задеть замок (карта Р4). */
export interface LockablePatch {
  title?: unknown;
  description?: unknown;
  deadline?: unknown;
  priority?: unknown;
  plannedMinutes?: unknown;
  assigneeId?: unknown;
  projectId?: unknown;
  nodeId?: unknown;
  customFields?: Readonly<Record<string, unknown>>;
}

/**
 * Ключи замка, которые затрагивает патч карточки или окна (карта Р4:
 * assignee→assigneeId, project→projectId+nodeId, cf.<id>→customFields[id]).
 * Перечисляет ЗАТРОНУТЫЕ ключи; меняется ли значение на самом деле,
 * сравнивает вызывающий со свежим значением записи (как FORMULA_CELL_LOCKED).
 */
export function lockKeysOfPatch(patch: LockablePatch): string[] {
  const keys: string[] = [];
  const has = (name: keyof LockablePatch) => patch[name] !== undefined;
  if (has('title')) keys.push('title');
  if (has('description')) keys.push('description');
  if (has('deadline')) keys.push('deadline');
  if (has('priority')) keys.push('priority');
  if (has('plannedMinutes')) keys.push('plannedMinutes');
  if (has('assigneeId')) keys.push('assignee');
  if (has('projectId') || has('nodeId')) keys.push('project');
  for (const fieldId of Object.keys(patch.customFields ?? {})) keys.push(customFieldKey(fieldId));
  return keys;
}

/** `details` 422 `FIELD_LOCKED`: закреплённые ключи и причина отказа. */
export const fieldLockedDetailsSchema = z.object({
  keys: z.array(z.string().min(1)).min(1),
  reason: lockDenialSchema,
});
export type FieldLockedDetails = z.infer<typeof fieldLockedDetailsSchema>;

/** Замок в детали задачи (Р10): только ключи текущего типа; `canEdit`
 *  считает сервер — право пути И правило замка без учёта причины. */
export const taskFieldLockSchema = z.object({
  key: z.string().min(1).max(64),
  editors: lockEditorsSchema,
  lockedAt: z.iso.datetime(),
  lockedBy: userRefSchema.nullable(),
  source: fieldLockSourceSchema,
  lastChange: z
    .object({
      at: z.iso.datetime(),
      by: userRefSchema,
      reason: z.string().min(1).max(FIELD_LOCK_LIMITS.reason),
    })
    .optional(),
  canEdit: z.boolean(),
});
export type TaskFieldLock = z.infer<typeof taskFieldLockSchema>;
