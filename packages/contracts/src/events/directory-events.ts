import { z } from 'zod';

import { permissionSchema } from '../auth/permission.js';

/**
 * Каталог доменных событий модуля directory (I9; префикс = модуль-владелец,
 * api-conventions.md). Здесь — ВСЕ события, которые эмитит код: подразделения,
 * должности, роли и сотрудники (раньше отделы/должности/роли шли строковыми
 * литералами, а каталог отставал от кода — #379, Н2).
 *
 * Подписчики: auth (отзыв сессий деактивированного, сброс пароля — #101),
 * search (индекс сотрудника по created/updated/deactivated/activated/deleted),
 * gateway (разрыв WS-сокетов деактивированного, #317). `role.permissions_changed`
 * gateway пока не маршрутизирует: подписчиков у клиентов нет — их добавит #382.
 * `user.activated` парен деактивации (AUD-016): сессии не восстанавливаются
 * (сотрудник входит заново), search переиндексирует запись.
 */
export const DIRECTORY_EVENTS = {
  USER_CREATED: 'directory.user.created',
  USER_UPDATED: 'directory.user.updated',
  USER_DEACTIVATED: 'directory.user.deactivated',
  USER_ACTIVATED: 'directory.user.activated',
  /** Пользователь удалён жёстко (истечение неактивированного приглашения, #101). */
  USER_DELETED: 'directory.user.deleted',
  /** Приглашение по ссылке (#101): создано/перевыпущено. */
  INVITATION_CREATED: 'directory.invitation.created',
  /** Приглашение принято: пароль задан, статус active. */
  INVITATION_ACCEPTED: 'directory.invitation.accepted',
  /** Приглашение отменено админом (`reason: 'cancelled'`). */
  INVITATION_REVOKED: 'directory.invitation.revoked',
  /** Приглашение истекло: строка удалена или возвращена в «Уволен». */
  INVITATION_EXPIRED: 'directory.invitation.expired',
  /** Админ выпустил ссылку сброса пароля (#101) — auth гасит сессии. */
  USER_PASSWORD_RESET_ISSUED: 'directory.user.password_reset_issued',
  /** Пароль изменён по reset-ссылке — auth повторно гасит сессии. */
  USER_PASSWORD_CHANGED: 'directory.user.password_changed',
  DEPARTMENT_CREATED: 'directory.department.created',
  DEPARTMENT_UPDATED: 'directory.department.updated',
  /** Устаревшее: подразделения больше не архивируются (#881, жёсткое удаление).
   *  Имя остаётся в каталоге — события прошлых периодов живут в `events`. */
  DEPARTMENT_ARCHIVED: 'directory.department.archived',
  /** Подразделение удалено жёстко: дети и прямые сотрудники перенесены к
   *  родителю; `userIds` — прямые сотрудники (включая уволенных) для search. */
  DEPARTMENT_DELETED: 'directory.department.deleted',
  POSITION_CREATED: 'directory.position.created',
  POSITION_UPDATED: 'directory.position.updated',
  /** Устаревшее: должности больше не архивируются (#768, жёсткое удаление).
   *  Имя остаётся в каталоге — события прошлых периодов живут в `events`. */
  POSITION_ARCHIVED: 'directory.position.archived',
  /** Должность удалена жёстко: держателей (включая уволенных) уже перевели. */
  POSITION_DELETED: 'directory.position.deleted',
  ROLE_CREATED: 'directory.role.created',
  /** Только смена `name/description`: состав прав несёт `ROLE_PERMISSIONS_CHANGED`. */
  ROLE_UPDATED: 'directory.role.updated',
  ROLE_DELETED: 'directory.role.deleted',
  /** Любое реальное изменение состава прав роли — по событию на право (#379). */
  ROLE_PERMISSIONS_CHANGED: 'directory.role.permissions_changed',
  /** Сотрудника или подразделение добавили в роль / убрали из неё (#379). */
  ROLE_MEMBERS_CHANGED: 'directory.role.members_changed',
  /** У этих пользователей изменился набор действующих прав роли (#866,
   *  AUD-002): auth обесценивает их access-токены — права из JWT не живут
   *  до истечения TTL. */
  ROLE_ACCESS_CHANGED: 'directory.role.access_changed',
} as const;

export const userDeactivatedPayloadSchema = z.object({
  userId: z.uuid(),
});
export type UserDeactivatedPayload = z.infer<typeof userDeactivatedPayloadSchema>;

/** Payload `directory.user.activated` — парен деактивации (AUD-016). */
export const userActivatedPayloadSchema = z.object({
  userId: z.uuid(),
});
export type UserActivatedPayload = z.infer<typeof userActivatedPayloadSchema>;

export const userDeletedPayloadSchema = z.object({
  userId: z.uuid(),
});
export type UserDeletedPayload = z.infer<typeof userDeletedPayloadSchema>;

export const invitationCreatedPayloadSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  expiresAt: z.iso.datetime(),
});
export type InvitationCreatedPayload = z.infer<typeof invitationCreatedPayloadSchema>;

export const invitationAcceptedPayloadSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
});
export type InvitationAcceptedPayload = z.infer<typeof invitationAcceptedPayloadSchema>;

export const invitationRevokedPayloadSchema = z.object({
  userId: z.uuid(),
  reason: z.enum(['cancelled', 'expired']),
});
export type InvitationRevokedPayload = z.infer<typeof invitationRevokedPayloadSchema>;

export const invitationExpiredPayloadSchema = z.object({
  userId: z.uuid(),
});
export type InvitationExpiredPayload = z.infer<typeof invitationExpiredPayloadSchema>;

export const userPasswordResetIssuedPayloadSchema = z.object({
  userId: z.uuid(),
  byAdminId: z.uuid(),
});
export type UserPasswordResetIssuedPayload = z.infer<typeof userPasswordResetIssuedPayloadSchema>;

export const userPasswordChangedPayloadSchema = z.object({
  userId: z.uuid(),
});
export type UserPasswordChangedPayload = z.infer<typeof userPasswordChangedPayloadSchema>;

/** Payload `directory.role.permissions_changed`: выдали (`granted: true`) или отозвали. */
export const rolePermissionsChangedPayloadSchema = z.object({
  roleId: z.uuid(),
  permission: permissionSchema,
  granted: z.boolean(),
});
export type RolePermissionsChangedPayload = z.infer<typeof rolePermissionsChangedPayloadSchema>;

/** Payload `directory.role.members_changed`: `kind` — кого именно, `targetId` — его id. */
export const roleMembersChangedPayloadSchema = z.object({
  roleId: z.uuid(),
  kind: z.enum(['user', 'department']),
  targetId: z.uuid(),
  added: z.boolean(),
});
export type RoleMembersChangedPayload = z.infer<typeof roleMembersChangedPayloadSchema>;

/**
 * Payload `directory.role.access_changed`: `userIds` — активные сотрудники,
 * чьи действующие права определяются ролью на момент изменения (прямые
 * участники и сотрудники подразделений роли; #866, AUD-002). `reason`:
 * `membership` — состав роли, `permissions` — набор прав роли.
 */
export const roleAccessChangedPayloadSchema = z.object({
  roleId: z.uuid(),
  reason: z.enum(['membership', 'permissions']),
  userIds: z.array(z.uuid()).min(1),
});
export type RoleAccessChangedPayload = z.infer<typeof roleAccessChangedPayloadSchema>;

/**
 * Payload `directory.department.deleted` (#881): строка подразделения исчезает
 * безвозвратно, поэтому имя замораживается в событии (как `position.deleted`).
 * `parentId` — куда переехали дети и прямые сотрудники; `userIds` — прямые
 * сотрудники (включая уволенных), их карточки переиндексирует search.
 */
export const departmentDeletedPayloadSchema = z.object({
  departmentId: z.uuid(),
  name: z.string().min(1),
  parentId: z.uuid(),
  childDepartmentIds: z.array(z.uuid()),
  userIds: z.array(z.uuid()),
});
export type DepartmentDeletedPayload = z.infer<typeof departmentDeletedPayloadSchema>;
