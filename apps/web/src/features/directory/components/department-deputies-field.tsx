import { Plus, X } from 'lucide-react';
import type { DepartmentDeputy, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { PeoplePicker } from '../../../shared/ui/people-picker.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';

/**
 * Заместители подразделения (#817): их НЕСКОЛЬКО — чипы «аватар + имя» с
 * крестиком снятия и «+» с поиском по справочнику (та же модель множественного
 * выбора, что у соисполнителей задачи: `PeoplePicker multiple`). Пикер ищет
 * АКТИВНЫХ сотрудников (серверный фильтр `status=active`), поэтому назначить
 * уволенного нельзя; уже назначенный уволенный остаётся чипом (подпись берётся
 * из денормализованного `deputies` узла) — ссылка не теряется.
 */
export function DepartmentDeputiesField({
  selectedIds,
  users,
  assigned,
  onToggle,
  ariaLabel,
}: {
  selectedIds: readonly string[];
  /** Справочник сотрудников для аватаров и должностей чипов. */
  users: UserListItem[];
  /** Денормализованные заместители узла — имена уволенных/вне списка. */
  assigned: DepartmentDeputy[];
  onToggle: (userId: string) => void;
  ariaLabel: string;
}) {
  const personOf = (id: string): { displayName: string; avatarUrl: string | null } => {
    const user = users.find((entry) => entry.id === id);
    if (user) return { displayName: user.displayName, avatarUrl: user.avatarUrl };
    return {
      displayName: assigned.find((deputy) => deputy.id === id)?.displayName ?? '',
      avatarUrl: null,
    };
  };

  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input px-1.5 py-1">
      {selectedIds.length === 0 ? (
        <span className="px-1 text-xs text-muted-foreground">{ui.common.notSet}</span>
      ) : (
        selectedIds.map((id) => {
          const person = personOf(id);
          return (
            <span
              key={id}
              className="flex items-center gap-1 rounded-md bg-accent py-0.5 pr-1 pl-0.5 text-xs"
            >
              <PersonAvatar
                name={person.displayName}
                avatarUrl={person.avatarUrl}
                className="size-4"
              />
              <span className="max-w-36 truncate">{person.displayName}</span>
              <button
                type="button"
                onClick={() => onToggle(id)}
                aria-label={`${ui.common.remove}: ${person.displayName}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          );
        })
      )}
      <PeoplePicker
        multiple
        selectedIds={selectedIds}
        onToggle={(userId) => onToggle(userId)}
        ariaLabel={`${ui.common.add}: ${ariaLabel}`}
      >
        <button
          type="button"
          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`${ui.common.add}: ${ariaLabel}`}
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      </PeoplePicker>
    </div>
  );
}
