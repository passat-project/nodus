import type { UserCard, UserListItem } from '@nodus/contracts';

import type { UserCardRow, UserListRow } from './users.repository.js';

/** ДТО сотрудников: мапперы строк БД в контракты (patterns.md, role-dto.ts). */

/** «Фамилия Имя» — денормализация для списков и JWT. Отчество в displayName
 *  НЕ входит (#132, фидбек пилотов: слишком формально; поле middleName
 *  остаётся в справочнике и карточке сотрудника, включалка отображения —
 *  будущее «Настройки портала» #133). Единая точка: ~40 мест UI рендерят
 *  displayName сырым. */
export function buildDisplayName(parts: {
  lastName: string;
  firstName: string;
  /** Приходит из модели/DTO — ПРИНИМАЕТСЯ и игнорируется: callers с полным
   *  объектом не чистят поле сами (тест #132 прямо проверяет игнор). */
  middleName?: string | null;
}): string {
  return [parts.lastName, parts.firstName].filter((p): p is string => Boolean(p)).join(' ');
}

function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toUserCard(
  row: UserCardRow,
  avatarUrlOf: (fileId: string | null) => string | null,
): UserCard {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    lastName: row.lastName,
    firstName: row.firstName,
    middleName: row.middleName,
    managerId: row.managerId,
    departmentId: row.departmentId,
    positionId: row.positionId,
    legalDepartmentId: row.legalDepartmentId,
    legalPositionId: row.legalPositionId,
    mobilePhone: row.mobilePhone,
    city: row.city,
    officeLocation: row.officeLocation,
    isRemote: row.isRemote,
    workRate: row.workRate,
    gender: row.gender,
    birthDate: toIsoDate(row.birthDate),
    hiredAt: toIsoDate(row.hiredAt),
    workdayStart: row.workdayStart,
    avatarUrl: avatarUrlOf(row.avatarFileId),
    roles: row.roles.map((ur) => ({ id: ur.role.id, code: ur.role.code, name: ur.role.name })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toListItem(
  row: UserListRow,
  avatarUrlOf: (fileId: string | null) => string | null,
): UserListItem {
  return {
    id: row.id,
    displayName: row.displayName,
    status: row.status,
    avatarUrl: avatarUrlOf(row.avatarFileId),
    email: row.email,
    managerId: row.managerId,
    departmentId: row.departmentId,
    legalDepartmentId: row.legalDepartmentId,
    positionId: row.positionId,
    legalPositionId: row.legalPositionId,
    positionName: row.position?.name ?? null,
    departmentName: row.department?.name ?? null,
  };
}
