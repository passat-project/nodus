import { Search, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { ApiError } from '../../../shared/api-client.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import {
  searchFacets,
  searchHint,
  searchHits,
  searchTotal,
  useSearchResults,
} from '../api/search-api.js';
import { useOpenSearchHit } from '../lib/open-result.js';
import { useSearchStore } from '../model/search-store.js';
import { SearchFacets } from './search-facets.js';
import { SearchFilters } from './search-filters.js';
import { SearchHitRow } from './search-hit-row.js';
import { SearchPreview } from './search-preview.js';

/**
 * Рабочее состояние поиска (#952, поверхность A): лист во всю ширину рамы,
 * верх — на живой оси контура, z-62 (выше окна ассистента z-60). Фасеты
 * слева, единый ранжированный список, превью справа; <1100px превью
 * скрыто, <760px — фасеты. Esc закрывает, Enter открывает выбранный,
 * Ctrl+K (глобально) — тоже закрывает.
 */
export function SearchPanel({ top }: { top: number }) {
  const mode = useSearchStore((state) => state.mode);
  const close = useSearchStore((state) => state.close);
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const types = useSearchStore((state) => state.types);
  const projectId = useSearchStore((state) => state.projectId);
  const period = useSearchStore((state) => state.period);
  const sort = useSearchStore((state) => state.sort);
  const openHit = useOpenSearchHit();
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebouncedValue(query.trim(), 200);
  const {
    data,
    isFetching,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSearchResults({ q: debounced, types, projectId, period, sort });

  const hits = searchHits(data);
  const total = searchTotal(data);
  const facets = searchFacets(data);
  const hint = searchHint(data);
  const keys = useMemo(() => hits.map((hit) => `${hit.type}:${hit.id}`), [hits]);
  // Выбор держится на текущем результате: исчез из выдачи — выбирается первый.
  // Синхронизация в рендере (канон React «adjust state during render»), без
  // эффекта и лишнего кадра.
  const [selected, setSelectedKey] = useState<string | null>(null);
  const selectedKey = selected !== null && keys.includes(selected) ? selected : (keys[0] ?? null);
  const activeIndex = selectedKey ? keys.indexOf(selectedKey) : -1;
  const activeHit = activeIndex >= 0 ? (hits[activeIndex] ?? null) : null;

  const move = useCallback(
    (delta: number) => {
      if (keys.length === 0) return;
      const next = Math.min(
        keys.length - 1,
        Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + delta),
      );
      setSelectedKey(keys[next] ?? null);
    },
    [activeIndex, keys, setSelectedKey],
  );

  if (mode !== 'workspace') return null;

  const timeout = error instanceof ApiError && error.code === 'SEARCH_TIMEOUT';

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={ui.search.title}
      className="absolute inset-x-0 bottom-0 z-[62] flex min-h-0 flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-lg"
      style={{ top }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex flex-col gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              } else if (event.key === 'Enter' && activeHit) {
                event.preventDefault();
                openHit(activeHit);
              }
            }}
            placeholder={ui.search.placeholder}
            aria-label={ui.search.placeholder}
            className="h-9 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {isFetching ? ui.search.loading : total > 0 ? `${ui.search.total}: ${total}` : ''}
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={close}
            aria-label={ui.search.close}
            title={ui.search.close}
          >
            <X />
          </Button>
        </div>
        <SearchFilters facets={facets} />
      </div>

      <div className="flex min-h-0 flex-1">
        <SearchFacets facets={facets} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            role="listbox"
            aria-label={ui.search.title}
            aria-activedescendant={selectedKey ?? undefined}
            className="min-h-0 flex-1 overflow-y-auto p-2"
          >
            {isLoading ? <LoadingRows /> : null}

            {!isLoading && isError ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <p className="text-sm font-medium">
                  {timeout ? ui.search.timeoutTitle : ui.search.errorTitle}
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {timeout ? ui.search.timeoutHint : ui.search.errorHint}
                </p>
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  {ui.search.retry}
                </Button>
              </div>
            ) : null}

            {!isLoading && !isError && query.trim().length < 2 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {ui.search.emptyHint}
              </p>
            ) : null}

            {!isLoading && !isError && debounced.length >= 2 && hits.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                <p className="text-sm font-medium">
                  {hint === 'index_empty' ? ui.search.hintIndexEmpty : ui.search.emptyTitle}
                </p>
                {hint === 'stopwords' ? (
                  <p className="max-w-md text-sm text-muted-foreground">
                    {ui.search.hintStopwords}
                  </p>
                ) : hint === null ? (
                  <p className="max-w-md text-sm text-muted-foreground">{ui.search.emptyHint}</p>
                ) : null}
              </div>
            ) : null}

            {hits.map((hit, index) => {
              const key = `${hit.type}:${hit.id}`;
              return (
                <div key={key} id={key}>
                  <SearchHitRow
                    hit={hit}
                    active={index === activeIndex}
                    showReasons
                    onSelect={() => setSelectedKey(key)}
                    onOpen={() => openHit(hit)}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
            <span>
              {total > 0
                ? `${hits.length} / ${total}${data?.pages[0]?.totalCapped ? '+' : ''}`
                : debounced.length >= 2 && !isError
                  ? ui.search.emptyTitle
                  : ''}
            </span>
            {hasNextPage ? (
              <Button
                size="sm"
                variant="outline"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {ui.search.showMore}
              </Button>
            ) : null}
          </div>
        </div>

        <SearchPreview hit={activeHit} onOpen={() => activeHit && openHit(activeHit)} />
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 p-1">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-start gap-2.5 px-2.5 py-2">
          <Skeleton className="size-4 rounded" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
