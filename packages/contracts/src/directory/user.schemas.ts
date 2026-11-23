import { z } from 'zod';

import { emailInputSchema, passwordSchema } from '../auth/auth.schemas.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';

/**
 * Контракты справочника сотрудников (directory.User).
 * Модель — эпик M2 (#18): гибкие связи (managerId), двойная структура
 * (управленческая и юридическая пары должность/подразделение — справочники, I15),
 * контактный блок карточки сотрудника.
 */

export const userStatusSchema = z.enum(['active', 'deactivated', 'invited']);
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
  /** Аватар — файл-дериват: относительный подписанный путь (канон подписных
   * ссылок; не z.url() — тот отбрасывал живые DTO, #880). null — инициалы. */
  avatarUrl: z.string().nullable(),
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
  /** Когда приглашён (null/нет — создан иначе/до #101). */
  invitedAt: z.iso.datetime().nullable().optional(),
  /** Когда впервые активировал учётку; null/нет — ещё не активировал. */
  activatedAt: z.iso.datetime().nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UserCard = z.infer<typeof userCardSchema>;

/** Строка списка сотрудников (с денормализованными названиями для UI). */
export const userListItemSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1),
  status: userStatusSchema,
  /** Аватар — относительный подписанный путь файла-деривата (не z.url(), #880). */
  avatarUrl: z.string().nullable(),
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

/** Элемент пути подразделения (от корня): для «в каком я подразделении». */
export const departmentPathItemSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});

/**
 * «Кто я» (#919): профиль сотрудника, его руководитель, подразделение с
 * путём от корня и подчинённые по оргструктуре. Источник — существующие
 * данные directory; новых ролей/таблиц нет. Права: `directory.read`
 * (оргструктура и карточки уже видны всем сотрудникам портала).
 */
export const myOrganizationSchema = z.object({
  user: userListItemSchema,
  manager: userListItemSchema.nullable(),
  department: z
    .object({
      id: z.uuid(),
      name: z.string().min(1),
      /** От корня к самому подразделению. */
      path: z.array(departmentPathItemSchema),
    })
    .nullable(),
  /** Подчинённые (по цепочке руководителей и руководству подразделениями). */
  subordinates: z.array(userListItemSchema),
  /** Сколько всего подчинённых (список может быть обрезан лимитом). */
  subordinatesTotal: z.number().int().nonnegative(),
});
export type MyOrganization = z.infer<typeof myOrganizationSchema>;

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

/** Создание сотрудника администратором (directory.manage).
 *  Руководитель НЕ принимается от клиента (#923): он производный — ближайший
 *  глава вверх по дереву подразделений, сервер считает его сам. */
export const createUserSchema = z.object({
  email: emailInputSchema,
  /** Начальный пароль — та же политика, что и при смене (сотрудник сменит при первом входе — V2). */
  password: passwordSchema,
  lastName: z.string().trim().min(1).max(128),
  firstName: z.string().trim().min(1).max(128),
  middleName: z.string().trim().min(1).max(128).nullable().default(null),
  departmentId: z.uuid().nullable().default(null),
  positionId: z.uuid().nullable().default(null),
  legalDepartmentId: z.uuid().nullable().default(null),
  legalPositionId: z.uuid().nullable().default(null),
  roleIds: z.array(z.uuid()).default([]),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;

/** Орг-поля карточки, доступные администратору при правке (#923):
 *  `managerId` — производный (сервер), `displayName` — из ФИО. */
const userOrgAdminShape = {
  departmentId: userOrgSchema.shape.departmentId,
  positionId: userOrgSchema.shape.positionId,
  legalDepartmentId: userOrgSchema.shape.legalDepartmentId,
  legalPositionId: userOrgSchema.shape.legalPositionId,
};

/** Обновление карточки администратором (directory.manage), всё опционально.
 *  `avatarUrl` не принимается: фото ставится только конвейером аватара
 *  (`POST/DELETE /users/me/avatar`), иначе админ мог бы записать произвольный
 *  внешний URL в карточку (#923, security-аудит). */
export const updateUserSchema = z
  .object({
    ...userNamesSchema.partial().shape,
    ...userOrgAdminShape,
    ...userProfileSchema.omit({ avatarUrl: true }).shape,
    roleIds: z.array(z.uuid()),
  })
  .partial();

export type UpdateUserDto = z.infer<typeof updateUserSchema>;

/**
 * Саморедактирование профиля сотрудником (#923, матрица полей владельца):
 * ФИО и личные/контактные поля. Структура (подразделение, должность,
 * руководитель), email-логин, ставка/дата приёма (HR), роли и статус в схему
 * НЕ входят — `.strict()` отвечает 400 на попытку прислать их (серверный
 * allowlist, I8: скрытие в UI защитой не считается).
 */
export const updateMyProfileSchema = z
  .object({
    ...userNamesSchema.shape,
    ...userProfileSchema.pick({
      mobilePhone: true,
      city: true,
      officeLocation: true,
      isRemote: true,
      gender: true,
      birthDate: true,
      workdayStart: true,
    }).shape,
  })
  .partial()
  .strict();

export type UpdateMyProfileDto = z.infer<typeof updateMyProfileSchema>;

/** Приглашение сотрудника по ссылке (#101): обязательные системные поля —
 *  ФИО, управленческие должность и подразделение, рабочая почта. Руководитель
 *  НЕ принимается (производный, ADR-0053). Ставка и дата приёма — HR-поля,
 *  которые сотрудник сам не правит (только администратор), поэтому задаются
 *  уже при приглашении; необязательны. */
export const createInvitationSchema = z.object({
  email: emailInputSchema,
  lastName: z.string().trim().min(1).max(128),
  firstName: z.string().trim().min(1).max(128),
  middleName: z.string().trim().min(1).max(128).nullable().default(null),
  positionId: z.uuid(),
  departmentId: z.uuid(),
  workRate: userProfileSchema.shape.workRate.default(null),
  hiredAt: userProfileSchema.shape.hiredAt.default(null),
});
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;

/** Ответ на создание/перевыпуск приглашения и на выпуск reset-ссылки.
 *  `token` и `path` отдаются один раз: в БД живёт только хеш. */
export const invitationCreatedSchema = z.object({
  id: z.uuid(),
  token: z.string().min(32),
  path: z.string().startsWith('/invite/'),
  expiresAt: z.iso.datetime(),
});
export type InvitationCreated = z.infer<typeof invitationCreatedSchema>;

export const issuePasswordResetResponseSchema = z.object({
  id: z.uuid(),
  token: z.string().min(32),
  path: z.string().startsWith('/reset/'),
  expiresAt: z.iso.datetime(),
});
export type IssuePasswordResetResponse = z.infer<typeof issuePasswordResetResponseSchema>;

/** Публичная информация по токену приглашения (префилл формы принятия). */
export const invitationInfoSchema = z.object({
  kind: z.literal('invite'),
  displayName: z.string().min(1),
  email: z.email(),
  departmentName: z.string().nullable(),
  positionName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type InvitationInfo = z.infer<typeof invitationInfoSchema>;

export const passwordResetInfoSchema = z.object({
  kind: z.literal('reset'),
  displayName: z.string().min(1),
  email: z.email(),
  expiresAt: z.iso.datetime(),
});
export type PasswordResetInfo = z.infer<typeof passwordResetInfoSchema>;

/** Принятие приглашения: сверка рабочей почты + пароль по общей политике. */
export const acceptInvitationSchema = z.object({
  email: emailInputSchema,
  password: passwordSchema,
});
export type AcceptInvitationDto = z.infer<typeof acceptInvitationSchema>;

export const acceptPasswordResetSchema = z.object({
  email: emailInputSchema,
  password: passwordSchema,
});
export type AcceptPasswordResetDto = z.infer<typeof acceptPasswordResetSchema>;

export const acceptResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
});
export type AcceptResponse = z.infer<typeof acceptResponseSchema>;
