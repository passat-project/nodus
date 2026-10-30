import type { Position, UserListItem } from '@nodus/contracts';

/** Строка отчёта проверки данных: id — для ключа списка (одинаковые имена
 *  в двух структурах и полные тёзки не ломают рендер). */
export interface DataCheckEntry {
  id: string;
  name: string;
}

export interface DataCheckResult {
  /** Должности обеих структур без активных держателей. */
  positionsWithoutEmployees: DataCheckEntry[];
  /** Активные сотрудники без руководителя. */
  withoutManager: DataCheckEntry[];
  /** Активные сотрудники без управленческого подразделения. */
  withoutDepartment: DataCheckEntry[];
}

/**
 * Отчёт проверки данных оргструктуры (#441): чистая функция — считается из
 * полных списков сотрудников (`fetchAllUsers` пагинирует все страницы) и
 * должностей обеих структур; отдельный эндпоинт не нужен на штате ~170.
 */
export function computeDataCheck(
  users: readonly UserListItem[],
  positions: readonly Position[],
): DataCheckResult {
  const active = users.filter((user) => user.status === 'active');
  return {
    positionsWithoutEmployees: positions
      .filter(
        (position) =>
          !active.some(
            (user) => user.positionId === position.id || user.legalPositionId === position.id,
          ),
      )
      .map((position) => ({ id: position.id, name: position.name })),
    withoutManager: active
      .filter((user) => !user.managerId)
      .map((user) => ({ id: user.id, name: user.displayName })),
    withoutDepartment: active
      .filter((user) => !user.departmentId)
      .map((user) => ({ id: user.id, name: user.displayName })),
  };
}
