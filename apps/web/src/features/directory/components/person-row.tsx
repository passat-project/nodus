import type { UserListItem } from '@nodus/contracts';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';

/**
 * Строка человека в панели подразделения (#84): аватар, имя, должность;
 * клик — карточка сотрудника в стеке из rect строки (ADR-0009). Общая для
 * руководителей, заместителей, состава и подчинённых.
 */
export function PersonRow({ person }: { person: UserListItem }) {
  const openCard = useOpenCard();
  return (
    <button
      type="button"
      onClick={(e) =>
        openCard({ kind: 'employee', id: person.id }, e.currentTarget.getBoundingClientRect())
      }
      className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent"
    >
      <PersonAvatar
        name={person.displayName}
        avatarUrl={person.avatarUrl}
        className="size-6 shrink-0"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm">{person.displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {person.positionName ?? ''}
        </span>
      </span>
    </button>
  );
}
