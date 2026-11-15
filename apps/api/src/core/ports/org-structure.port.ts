import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../database/transaction-runner.js';

/** Подразделение для показа ссылки (Р6): имя и признак активности —
 *  архивное подразделение у старого значения остаётся читаемым. */
export interface DepartmentRef {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Порт чтения оргструктуры (ADR-0012): модулю задач нужно «кто мои
 * подчинённые» для видимости задач (канон Битрикса: руководитель видит
 * задачи подчинённых), но users/departments принадлежат directory — прямой
 * доступ из чужих репозиториев запрещён (I3/I6). Первый потребитель — tasks
 * (#37); реализация — core/ports/org-structure.provider.ts.
 */
export interface OrgStructureReader {
  /** Все подчинённые сотрудника (без него самого): по цепочке прямых
   *  руководителей (manager_id вниз на любую глубину) и члены подразделений
   *  (с дочерними), где он руководитель или заместитель. */
  subordinateIds(userId: string): Promise<string[]>;

  /** Управленческое подразделение сотрудника (#431, Р5): значение по
   *  умолчанию «подразделение автора» и валидация типа «Подразделение».
   *  null — сотрудник без действующего управленческого подразделения. */
  departmentOf(userId: string, tx?: TransactionClient): Promise<string | null>;

  /** Подразделения по id — пачкой для DTO (Р6); отсутствующие пропущены. */
  departmentRefs(ids: readonly string[], tx?: TransactionClient): Promise<DepartmentRef[]>;

  /** Цепочка руководителей вверх (#441, ADR-0025 §3): `managerId`, иначе
   *  руководитель подразделения (management), иначе руководитель родительского
   *  — без циклов и самоссылки, глубина ≤ 32; ближайший руководитель первым,
   *  сам сотрудник в цепочку не входит; уволенные пропускаются (шаг идёт выше). */
  managerChainOf(userId: string, tx?: TransactionClient): Promise<string[]>;

  /** Ближайшие активные руководители пачки сотрудников (#433, В4): один
   *  рекурсивный CTE, `Map<сотрудник, руководитель>`; нет пары — руководителя
   *  нет (источник `manager_of` вакантен). */
  managersOf(userIds: readonly string[], tx?: TransactionClient): Promise<Map<string, string>>;
}

export const ORG_STRUCTURE_READER: InjectionToken = 'ORG_STRUCTURE_READER';
