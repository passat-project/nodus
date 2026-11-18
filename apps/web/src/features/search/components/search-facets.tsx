import type { SearchFacets as SearchFacetsValue, SearchSourceType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { SEARCH_TYPE_ORDER, searchTypeIcon, searchTypeLabel } from '../lib/search-labels.js';
import { useSearchStore } from '../model/search-store.js';

/**
 * Фасеты типов с количествами (#952): количества посчитаны по всем фильтрам,
 * кроме выбранного `types`, — чипы показывают, что ещё доступно. Тип без
 * совпадений скрыт (кроме выбранного: снятие фильтра всегда доступно).
 */
export function SearchFacets({ facets }: { facets: SearchFacetsValue['types'] }) {
  const types = useSearchStore((state) => state.types);
  const toggleType = useSearchStore((state) => state.toggleType);
  const clearTypes = useSearchStore((state) => state.clearTypes);
  const visible = SEARCH_TYPE_ORDER.filter(
    (type) => (facets[type] ?? 0) > 0 || types.includes(type),
  );

  return (
    <nav
      aria-label={ui.search.filters.allTypes}
      className="hidden w-[240px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 p-2 min-[760px]:flex"
    >
      <button
        type="button"
        onClick={clearTypes}
        className={cn(
          'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
          types.length === 0 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        )}
      >
        {ui.search.filters.allTypes}
      </button>
      {visible.map((type) => (
        <FacetButton
          key={type}
          type={type}
          count={facets[type] ?? 0}
          active={types.includes(type)}
          onClick={() => toggleType(type)}
        />
      ))}
    </nav>
  );
}

function FacetButton({
  type,
  count,
  active,
  onClick,
}: {
  type: SearchSourceType;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = searchTypeIcon(type);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{searchTypeLabel(type)}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
    </button>
  );
}
