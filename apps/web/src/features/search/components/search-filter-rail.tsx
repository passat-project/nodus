import type { ReactNode } from 'react';
import type { SearchFacets as SearchFacetsValue } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';

import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { useProjectsList } from '../../../shared/api/projects-list.js';
import { focusComposerWhenFree } from '../../../shared/chat/composer-focus.js';
import { SEARCH_TYPE_ORDER, searchTypeIcon, searchTypeLabel } from '../lib/search-labels.js';
import { useSearchStore, type SearchPeriod } from '../model/search-store.js';

const ALL = '__all__';

/**
 * Панель фильтров слева от выдачи (вердикт владельца 18.11.2026): типы
 * списком с количествами, период, сортировка, проект. Фасеты приходят по
 * всем фильтрам, кроме `types`, — счётчики показывают, что доступно при
 * снятии фильтра; тип без совпадений скрыт (кроме выбранного).
 */
export function SearchFilterRail({ facets }: { facets: SearchFacetsValue['types'] }) {
  const types = useSearchStore((state) => state.types);
  const toggleType = useSearchStore((state) => state.toggleType);
  const clearTypes = useSearchStore((state) => state.clearTypes);
  const projectId = useSearchStore((state) => state.projectId);
  const setProjectId = useSearchStore((state) => state.setProjectId);
  const period = useSearchStore((state) => state.period);
  const setPeriod = useSearchStore((state) => state.setPeriod);
  const sort = useSearchStore((state) => state.sort);
  const setSort = useSearchStore((state) => state.setSort);
  const resetFilters = useSearchStore((state) => state.resetFilters);
  const projects = useProjectsList({ enabled: projectsAvailable() });
  const hasFacets = Object.keys(facets).length > 0;
  // Счётчик «Все типы» — сумма фасетов (они посчитаны по всем фильтрам, кроме
  // выбранного типа): общее число найденного живёт здесь, а не в шапке окна.
  const facetTotal = Object.values(facets).reduce((sum, value) => sum + value, 0);
  // Все источники видны всегда (правка 18.11.2026): список типов — это карта
  // того, ПО ЧЕМУ ищет портал, а не только непустые фасеты; нули приглушены.
  const shownTypes = SEARCH_TYPE_ORDER;
  const filtersActive =
    types.length > 0 || projectId !== null || period !== 'any' || sort !== 'relevance';

  return (
    <aside
      aria-label={ui.search.filters.panel}
      className="flex w-[176px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-border/60 p-1.5"
    >
      <RailSection title={ui.search.filters.types}>
        <RailOption
          active={types.length === 0}
          onClick={clearTypes}
          count={hasFacets ? facetTotal : undefined}
        >
          {ui.search.filters.allTypes}
        </RailOption>
        {shownTypes.map((type) => (
          <TypeOption
            key={type}
            type={type}
            count={hasFacets ? (facets[type] ?? 0) : undefined}
            empty={hasFacets && (facets[type] ?? 0) === 0}
            active={types.includes(type)}
            onClick={() => toggleType(type)}
          />
        ))}
      </RailSection>

      <RailSection title={ui.search.filters.period}>
        {(
          [
            ['any', ui.search.filters.anyPeriod],
            ['week', ui.search.filters.week],
            ['month', ui.search.filters.month],
            ['year', ui.search.filters.year],
          ] as const
        ).map(([value, label]) => (
          <RailOption
            key={value}
            active={period === value}
            onClick={() => setPeriod(value as SearchPeriod)}
          >
            {label}
          </RailOption>
        ))}
      </RailSection>

      <RailSection title={ui.search.filters.sort}>
        <RailOption active={sort === 'relevance'} onClick={() => setSort('relevance')}>
          {ui.search.filters.relevance}
        </RailOption>
        <RailOption active={sort === 'newest'} onClick={() => setSort('newest')}>
          {ui.search.filters.newest}
        </RailOption>
      </RailSection>

      {projectsAvailable() ? (
        <RailSection title={ui.search.filters.project}>
          <Select
            value={projectId ?? ALL}
            onValueChange={(value) => setProjectId(value === ALL ? null : value)}
            onOpenChange={(next) => {
              // Закрыли список (в т.ч. Esc) — каретка возвращается в строку
              // поиска (канон «вечного курсора», #952).
              if (!next) focusComposerWhenFree('search:portal');
            }}
          >
            <SelectTrigger
              className="h-7 w-full min-w-0 text-[13px]"
              aria-label={ui.search.filters.project}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              <SelectItem value={ALL}>{ui.search.filters.anyProject}</SelectItem>
              {(projects.data?.items ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </RailSection>
      ) : null}

      {filtersActive ? (
        <button
          type="button"
          onClick={resetFilters}
          className="mt-auto rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
        >
          {ui.search.filters.reset}
        </button>
      ) : null}
    </aside>
  );
}

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="flex h-5 items-center px-2 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function RailOption({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Количество совпадений; undefined — ещё не считали (окно только открыто). */
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-6 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined ? (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

function TypeOption({
  type,
  count,
  empty,
  active,
  onClick,
}: {
  type: Parameters<typeof searchTypeLabel>[0];
  count: number | undefined;
  /** По текущему запросу совпадений нет — строка приглушена, но доступна. */
  empty: boolean;
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
        'flex h-6 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        !active && empty ? 'text-muted-foreground' : '',
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{searchTypeLabel(type)}</span>
      {count !== undefined ? (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}
