import { Clock, X } from 'lucide-react';
import { useEffect } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@nodus/ui/components/command';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { InputGroupButton } from '@nodus/ui/components/input-group';

import { ApiError } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { registerComposer, unregisterComposer } from '../../../shared/chat/composer-focus.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import { searchFacets, searchHint, searchHits, useSearchResults } from '../api/search-api.js';
import { searchQueryReady } from '../lib/search-state.js';
import { useOpenSearchHit } from '../lib/open-result.js';
import { useRecentSearches } from '../model/use-recent-searches.js';
import { useSearchStore } from '../model/search-store.js';
import { SearchFilterRail } from './search-filter-rail.js';
import { SearchHitContent } from './search-hit-row.js';

/**
 * Единственное окно поиска (#952, поверхность A): Ctrl+K — диалог с панелью
 * фильтров слева (типы с количествами, период, сортировка, проект) и плотной
 * выдачей справа: строка — два слоя текста, дата справа. При пустом поле —
 * только недавние запросы; навигации по модулям здесь нет (замечание
 * владельца 18.11.2026: поиск не должен уводить из окна). Результат
 * открывается карточкой в стеке / мессенджером с прыжком.
 */
export function SearchCommand() {
  const open = useSearchStore((state) => state.open);
  // Имя с суффиксом Search: голый `close` резолвится в глобальный
  // window.close() и молча не закрывает окно (баг 18.11.2026).
  const closeSearch = useSearchStore((state) => state.close);
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const types = useSearchStore((state) => state.types);
  const projectId = useSearchStore((state) => state.projectId);
  const period = useSearchStore((state) => state.period);
  const sort = useSearchStore((state) => state.sort);
  const openHit = useOpenSearchHit();
  const userId = useAuthStore((state) => state.user?.id);
  const recent = useRecentSearches(userId);

  // «Вечный курсор» (канон чатов): пока окно открыто, обычные клики по
  // фильтрам/кнопкам/пустому месту возвращают каретку в строку поиска.
  // Открытые поповеры и выделение текста guarded внутри механизма. Контент
  // Radix-диалога появляется в DOM после эффекта открытия — ждём кадром.
  useEffect(() => {
    if (!open) return;
    let attached: HTMLInputElement | null = null;
    let frame = 0;
    const attach = () => {
      const el = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
      if (!el) {
        frame = requestAnimationFrame(attach);
        return;
      }
      attached = el;
      registerComposer('search:portal', el);
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      if (attached) unregisterComposer('search:portal', attached);
    };
  }, [open]);

  const debounced = useDebouncedValue(query.trim(), 200);
  // Состояния выдачи показываем только под АКТУАЛЬНЫЙ текст поля: после
  // очистки дебаунс ещё держит старый запрос и «Ничего не найдено» мигало
  // поверх подсказки (замечание владельца 18.11.2026).
  const queryReady = searchQueryReady(query);
  const canSearch = queryReady && debounced.length >= 2;
  const {
    data,
    isFetching,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSearchResults({ q: debounced, types, projectId, period, sort });
  const hits = searchHits(data);
  const facets = searchFacets(data);
  const hint = searchHint(data);
  const timeout = error instanceof ApiError && error.code === 'SEARCH_TIMEOUT';

  function pick(hit: Parameters<typeof openHit>[0]) {
    recent.push(query);
    openHit(hit);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : closeSearch())}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden bg-popover p-0 text-popover-foreground sm:max-w-[880px]"
      >
        <DialogTitle className="sr-only">{ui.search.title}</DialogTitle>
        <div className="flex h-[min(70vh,540px)] min-h-[320px]">
          <SearchFilterRail facets={facets} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col p-0">
              {/* Без нижней линии: у поля своя рамка, вторая черта впритык
                  читалась сдвоенной (замечание владельца 18.11.2026). */}
              <div>
                <CommandInput
                  autoFocus
                  placeholder={ui.search.placeholder}
                  value={query}
                  onValueChange={setQuery}
                  action={
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={query.trim() !== '' ? ui.search.clear : ui.search.close}
                      title={query.trim() !== '' ? ui.search.clear : ui.search.close}
                      onClick={() => (query.trim() !== '' ? setQuery('') : closeSearch())}
                    >
                      <X />
                    </InputGroupButton>
                  }
                />
              </div>

              <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto p-1">
                {query.trim() === '' ? (
                  recent.items.length > 0 ? (
                    <CommandGroup heading={ui.search.recent}>
                      {recent.items.map((item) => (
                        <CommandItem
                          key={item}
                          value={`recent:${item}`}
                          onSelect={() => setQuery(item)}
                        >
                          <Clock data-icon="inline-start" />
                          <span className="truncate">{item}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {ui.search.startHint}
                    </p>
                  )
                ) : null}

                {query.trim() !== '' && debounced.length < 2 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {ui.search.emptyHint}
                  </p>
                ) : null}

                {canSearch && isError ? (
                  <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                    <p className="text-sm font-medium">
                      {timeout ? ui.search.timeoutTitle : ui.search.errorTitle}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {timeout ? ui.search.timeoutHint : ui.search.errorHint}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => void refetch()}>
                      {ui.search.retry}
                    </Button>
                  </div>
                ) : null}

                {canSearch && !isError && !isFetching && hits.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
                    <p className="text-sm font-medium">
                      {hint === 'index_empty' ? ui.search.hintIndexEmpty : ui.search.emptyTitle}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {hint === 'stopwords' ? ui.search.hintStopwords : ui.search.emptyHint}
                    </p>
                  </div>
                ) : null}

                {/* Строки — только под актуальный текст поля: после очистки
                    старые результаты не висят под подсказкой 200 мс. */}
                {queryReady
                  ? hits.map((hit) => (
                      <CommandItem
                        key={`${hit.type}:${hit.id}`}
                        value={`${hit.type}:${hit.id}`}
                        onSelect={() => pick(hit)}
                        className="items-center p-0 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                      >
                        <div className="flex w-full min-w-0 items-center gap-2 px-2 py-1">
                          <SearchHitContent hit={hit} />
                        </div>
                      </CommandItem>
                    ))
                  : null}

                {queryReady && hasNextPage ? (
                  <div className="p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-muted-foreground"
                      disabled={isFetchingNextPage}
                      onClick={() => void fetchNextPage()}
                    >
                      {ui.search.showMore}
                    </Button>
                  </div>
                ) : null}
              </CommandList>
            </Command>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
