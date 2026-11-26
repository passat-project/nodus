import type { NodeKind } from '@nodus/contracts';
import { kindAllowedByType, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';

import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Раздел «Где используется» экрана типа папки (#857): типы проектов, где
 * этот тип папки разрешён (`kindIds`; `null` — все типы папок проекта).
 * Read-only: связь настраивается на странице «Какие папки здесь бывают»
 * типа проекта; клик по строке открывает этот тип проекта.
 */
export function NodeKindUsageSection({
  kind,
  onOpenProjectType,
}: {
  kind: NodeKind;
  onOpenProjectType: (id: string) => void;
}) {
  const typesQuery = useProjectTypes();
  const types = (typesQuery.data ?? []).filter((type) => type.archivedAt === null);
  const allowed = types.filter((type) => kindAllowedByType(type.kindIds, kind.id));

  if (types.length === 0) {
    return (
      <Empty>
        <EmptyTitle>{ui.automation.creationScope.projectTypesEmpty}</EmptyTitle>
      </Empty>
    );
  }

  if (allowed.length === 0) {
    return (
      <Empty>
        <EmptyTitle>{ui.nodeKinds.screen.usageEmpty}</EmptyTitle>
      </Empty>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      {allowed.map((type) => (
        <button
          key={type.id}
          type="button"
          onClick={() => onOpenProjectType(type.id)}
          title={type.name}
          className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
        >
          <span
            aria-hidden
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg border',
              identityTone[type.color].tile,
            )}
          >
            <ProcessTypeGlyph icon={type.icon} className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{type.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {type.kindIds === null ? ui.nodeKinds.screen.usageAll : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
