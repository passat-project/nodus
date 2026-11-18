import type { SearchFacets as SearchFacetsValue } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { useProjectsList } from '../../../shared/api/projects-list.js';
import { useSearchStore, type SearchPeriod } from '../model/search-store.js';

const ALL = '__all__';

/** Фильтры рабочего окна (ответ В4 — «фильтры сверху»): проект, период,
 *  сортировка. Типы — фасетами слева; выбранные типы показываются и здесь
 *  счётчиком, чтобы фильтр не терялся на узкой ширине. */
export function SearchFilters({ facets }: { facets: SearchFacetsValue['types'] }) {
  const projectId = useSearchStore((state) => state.projectId);
  const setProjectId = useSearchStore((state) => state.setProjectId);
  const period = useSearchStore((state) => state.period);
  const setPeriod = useSearchStore((state) => state.setPeriod);
  const sort = useSearchStore((state) => state.sort);
  const setSort = useSearchStore((state) => state.setSort);
  const types = useSearchStore((state) => state.types);
  const resetFilters = useSearchStore((state) => state.resetFilters);
  const projects = useProjectsList({ enabled: projectsAvailable() });
  const filtersActive =
    projectId !== null || period !== 'any' || sort !== 'relevance' || types.length > 0;
  const selectedFacetCount = types.reduce((sum, type) => sum + (facets[type] ?? 0), 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {projectsAvailable() ? (
        <Select
          value={projectId ?? ALL}
          onValueChange={(value) => setProjectId(value === ALL ? null : value)}
        >
          <SelectTrigger className="h-8 w-[220px] min-w-0" aria-label={ui.search.filters.project}>
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
      ) : null}

      <Select value={period} onValueChange={(value) => setPeriod(value as SearchPeriod)}>
        <SelectTrigger className="h-8 w-[160px]" aria-label={ui.search.filters.period}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          <SelectItem value="any">{ui.search.filters.anyPeriod}</SelectItem>
          <SelectItem value="week">{ui.search.filters.week}</SelectItem>
          <SelectItem value="month">{ui.search.filters.month}</SelectItem>
          <SelectItem value="year">{ui.search.filters.year}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sort} onValueChange={(value) => setSort(value as 'relevance' | 'newest')}>
        <SelectTrigger className="h-8 w-[170px]" aria-label={ui.search.filters.sort}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          <SelectItem value="relevance">{ui.search.filters.relevance}</SelectItem>
          <SelectItem value="newest">{ui.search.filters.newest}</SelectItem>
        </SelectContent>
      </Select>

      {filtersActive ? (
        <button
          type="button"
          onClick={resetFilters}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {ui.search.filters.reset}
          {types.length > 0 ? ` · ${ui.search.total}: ${selectedFacetCount}` : ''}
        </button>
      ) : null}
    </div>
  );
}
