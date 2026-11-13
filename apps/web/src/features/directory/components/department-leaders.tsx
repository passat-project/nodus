import type { DepartmentDeputy, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { PersonRow } from './person-row.js';

/**
 * Справочная строка человека, которого нет в загруженном справочнике:
 * уволенный или пришедший из другой структуры лидер всё равно остаётся
 * кликабельным (панель не теряет назначенных, #441).
 */
function personRef(id: string, displayName: string): UserListItem {
  return {
    id,
    displayName,
    status: 'active',
    avatarUrl: null,
    positionName: null,
    departmentName: null,
    email: '',
    managerId: null,
    departmentId: null,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
  };
}

/**
 * Секция «Руководители» правой панели подразделения (#84, #817): руководитель
 * и ВСЕ заместители — каждый строкой с аватаром и должностью, клик открывает
 * карточку сотрудника (ADR-0009). Заместителей несколько: список скроллится
 * после четырёх с половиной строк, чтобы длинный состав не выдавливал состав
 * подразделения. Поиск панели лидеров не фильтрует — они видны всегда.
 */
export function DepartmentLeaders({
  headId,
  headName,
  deputies,
  users,
}: {
  headId: string | null;
  headName: string | null;
  deputies: DepartmentDeputy[];
  users: UserListItem[];
}) {
  const resolve = (id: string, displayName: string | null): UserListItem =>
    users.find((user) => user.id === id) ?? personRef(id, displayName ?? '');

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{ui.employees.panelHead}</span>
        {headId && headName ? (
          <PersonRow person={resolve(headId, headName)} />
        ) : (
          <span className="px-2 text-xs text-muted-foreground">{ui.common.notSet}</span>
        )}
      </section>
      {deputies.length > 0 && (
        <section className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {ui.employees.panelDeputies}
          </span>
          <div className="flex max-h-44 flex-col gap-0.5 overflow-auto">
            {deputies.map((deputy) => (
              <PersonRow key={deputy.id} person={resolve(deputy.id, deputy.displayName)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
