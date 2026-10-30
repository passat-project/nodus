import { z } from 'zod';

import { emailInputSchema, passwordSchema } from '../auth/auth.schemas.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';

/**
 * Контракты справочника сотрудников (directory.User).
 * Модель — эпик M2 (#18): гибкие связи (managerId), двойная структура
 * (управленческая и юридическая пары должность/подразделение — справочники, I15),
 * контактный блок карточки сотрудника.
 */

export const userStatusSchema = z.enum(['active', 'deactivated']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const genderSchema = z.enum(['male', 'female']);
export type Gender = z.infer<typeof genderSchema>;

const workdayStartSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: 'Expected HH:mm',
});

/** Орг-связи сотрудника (справочники по ID, I15 — не свободный текст). */
export const userOrgSchema = z.object({
  /** Прямой руководитель — гибкая связь внутри группы (ГИП ↔ помощник), без фиктивных отделов. */
  managerId: z.uuid().nullable(),
  /** Управленческое подразделение → departments (kind=management). */
  departmentId: z.uuid().nullable(),
  /** Управленческая должность → positions (kind=management). */
  positionId: z.uuid().nullable(),
  /** Юридическое подразделение (по трудовой) → departments (kind=legal). */
  legalDepartmentId: z.uuid().nullable(),
  /** Юридическая должность (по трудовой) → positions (kind=legal). */
  legalPositionId: z.uuid().nullable(),
});

/** Контактный блок карточки (редактируется и самим сотрудником). */
export const userProfileSchema = z.object({
  mobilePhone: z.string().max(32).nullable(),
  city: z.string().max(128).nullable(),
  /** Кабинет / где находится («7.3»). */
  officeLocation: z.string().max(64).nullable(),
  isRemote: z.boolean(),
  /** Рабочая ставка (1 = полная). */
  workRate: z.number().min(0).max(2).nullable(),
  gender: genderSchema.nullable(),
  birthDate: z.iso.date().nullable(),
  /** Дата приёма на работу. */
  hiredAt: z.iso.date().nullable(),
  workdayStart: workdayStartSchema.nullable(),
  avatarUrl: z.url().nullable(),
});

const userNamesSchema = z.object({
  lastName: z.string().trim().min(1).max(128),
  firstName: z.string().trim().min(1).max(128),
  middleName: z.string().trim().min(1).max(128).nullable(),
});

/** Карточка сотрудника (ответ API; passwordHash наружу не выходит никогда). */
export const userCardSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  status: userStatusSchema,
  ...userNamesSchema.shape,
  ...userOrgSchema.shape,
  ...userProfileSchema.shape,
  /** Роли сотрудника (RBAC-данные, не права — права разворачиваются в JWT). */
  roles: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UserCard = z.infer<typeof userCardSchema>;

/** Строка списка сотрудников (с денормализованными названиями для UI). */
export const userListItemSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1),
  status: userStatusSchema,
  avatarUrl: z.url().nullable(),
  positionName: z.string().nullable(),
  departmentName: z.string().nullable(),
  email: z.email(),
  managerId: z.uuid().nullable(),
  /** Управленческое подразделение (#84: вид «Подразделения», панель подразделения). */
  departmentId: z.uuid().nullable(),
  /** Юридическое подразделение (по трудовой) — вид «Подразделения» в режиме legal. */
  legalDepartmentId: z.uuid().nullable(),
  /** Должность управленческой структуры (#441: отчёт «должности без сотрудников»). */
  positionId: z.uuid().nullable(),
  /** Юридическая должность (#441). */
  legalPositionId: z.uuid().nullable(),
});

export type UserListItem = z.infer<typeof userListItemSchema>;

export const listUsersQuerySchema = cursorQuerySchema.extend({
  /** Поиск по ФИО и email (substring, case-insensitive). */
  search: z.string().trim().min(1).max(128).optional(),
  /** Фильтр по подразделению: принадлежность в ТОЙ структуре, к которой относится
   *  само подразделение (management → departmentId, legal → legalDepartmentId;
   *  kind сервер берёт из подразделения) — семантика панели подразделения (#84). */
  departmentId: z.uuid().optional(),
  status: userStatusSchema.optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Создание сотрудника администратором (directory.manage). */
export const createUserSchema = z.object({
  email: emailInputSchema,
  /** Начальный пароль — та же политика, что и при смене (сотрудник сменит при первом входе — V2). */
  password: passwordSchema,
  lastName: z.string().trim().min(1).max(128),
  firstName: z.string().trim().min(1).max(128),
  middleName: z.string().trim().min(1).max(128).nullable().default(null),
  managerId: z.uuid().nullable().default(null),
  departmentId: z.uuid().nullable().default(null),
  positionId: z.uuid().nullable().default(null),
  legalDepartmentId: z.uuid().nullable().default(null),
  legalPositionId: z.uuid().nullable().default(null),
  roleIds: z.array(z.uuid()).default([]),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;

/** Обновление карточки администратором (directory.manage), всё опционально. */
export const updateUserSchema = z
  .object({
    ...userNamesSchema.partial().shape,
    ...userOrgSchema.shape,
    ...userProfileSchema.shape,
    displayName: z.string().trim().min(1).max(256),
    roleIds: z.array(z.uuid()),
  })
  .partial();

export type UpdateUserDto = z.infer<typeof updateUserSchema>;

/** Саморедактирование профиля сотрудником — только контактный блок. */
export const updateMyProfileSchema = userProfileSchema
  .pick({
    mobilePhone: true,
    city: true,
    officeLocation: true,
    birthDate: true,
    workdayStart: true,
    avatarUrl: true,
  })
  .partial();

export type UpdateMyProfileDto = z.infer<typeof updateMyProfileSchema>;

/** Приглашение сотрудника (кнопка «Пригласить»): минимум — рабочая почта;
 *  роль/подразделение/письмо-инвайт — полный поток с бэкендом. */
export const createInvitationSchema = z.object({
  email: emailInputSchema,
});
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;
