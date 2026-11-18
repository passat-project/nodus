import {
  Clock,
  CornerDownLeft,
  FolderOpen,
  House,
  ListTodo,
  Mail,
  MessageSquare,
  Search,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
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

import { useAuthStore } from '../../../shared/auth-store.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import { searchHits, searchTotal, useSearchResults } from '../api/search-api.js';
import { searchTypeLabel, SEARCH_TYPE_ORDER } from '../lib/search-labels.js';
import { useOpenSearchHit } from '../lib/open-result.js';
import { useRecentSearches } from '../model/use-recent-searches.js';
import { useSearchStore } from '../model/search-store.js';
import { SearchHitContent } from './search-hit-row.js';

const actions = [
  { to: '/home', label: ui.nav.home, icon: House },
  { to: '/tasks', label: ui.nav.tasks, icon: ListTodo },
  { to: '/letters', label: ui.nav.letters, icon: Mail },
  { to: '/projects', label: ui.nav.projects, icon: FolderOpen },
  { to: '/chat', label: ui.nav.chat, icon: MessageSquare },
  { to: '/employees', label: ui.nav.employees, icon: Users },
];

/** Сколько строк на тип в компактной палитре (полное окно — «Ещё N»). */
const GROUP_LIMIT = 4;

/**
 * Компактное состояние поиска (#952, поверхность A): Ctrl+K — диалог 640px,
 * группы по типам, недавние запросы, «Открыть поиск» (Ctrl+Enter) в рабочее
 * окно. Результат открывается карточкой в стеке / мессенджером с прыжком.
 */
export function SearchCommand() {
  const mode = useSearchStore((state) => state.mode);
  const close = useSearchStore((state) => state.close);
  const openWorkspace = useSearchStore((state) => state.openWorkspace);
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const types = useSearchStore((state) => state.types);
  const projectId = useSearchStore((state) => state.projectId);
  const period = useSearchStore((state) => state.period);
  const sort = useSearchStore((state) => state.sort);
  const navigate = useNavigate();
  const openHit = useOpenSearchHit();
  const userId = useAuthStore((state) => state.user?.id);
  const recent = useRecentSearches(userId);
  const open = mode === 'compact';

  const debounced = useDebouncedValue(query.trim(), 200);
  const { data, isFetching, isError, refetch } = useSearchResults({
    q: debounced,
    types,
    projectId,
    period,
    sort,
  });
  const hits = searchHits(data);
  const total = searchTotal(data);

  const groups = useMemo(
    () =>
      SEARCH_TYPE_ORDER.map((type) => ({
        type,
        hits: hits.filter((hit) => hit.type === type).slice(0, GROUP_LIMIT),
      })).filter((group) => group.hits.length > 0),
    [hits],
  );
  const shown = groups.reduce((sum, group) => sum + group.hits.length, 0);

  function go(to: string, params?: Record<string, string>) {
    close();
    void navigate({ to, params } as never);
  }

  function pick(hit: Parameters<typeof openHit>[0]) {
    recent.push(query);
    openHit(hit);
  }

  function toWorkspace() {
    recent.push(query);
    openWorkspace();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-h-[60vh] overflow-hidden bg-popover p-0 text-popover-foreground sm:max-w-[640px]">
        <DialogTitle className="sr-only">{ui.search.title}</DialogTitle>
        <Command shouldFilter={false} className="p-0">
          <CommandInput
            autoFocus
            className="pr-8"
            placeholder={ui.search.placeholderCompact}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[42vh] overflow-y-auto p-1">
            {query.trim() === '' ? (
              <>
                {recent.items.length > 0 ? (
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
                ) : null}
                <CommandGroup heading={ui.search.title}>
                  {actions.map((action) => (
                    <CommandItem key={action.to} value={action.to} onSelect={() => go(action.to)}>
                      <action.icon data-icon="inline-start" />
                      {action.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}

            {query.trim() !== '' && debounced.length < 2 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {ui.search.emptyHint}
              </p>
            ) : null}

            {debounced.length >= 2 && isError ? (
              <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">{ui.search.errorTitle}</p>
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  {ui.search.retry}
                </Button>
              </div>
            ) : null}

            {debounced.length >= 2 && !isError && !isFetching && hits.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {ui.search.emptyTitle}
              </p>
            ) : null}

            {groups.map((group) => (
              <CommandGroup key={group.type} heading={searchTypeLabel(group.type)}>
                {group.hits.map((hit) => (
                  <CommandItem
                    key={`${hit.type}:${hit.id}`}
                    value={`${hit.type}:${hit.id}`}
                    onSelect={() => pick(hit)}
                    className="items-start p-0 data-[selected=true]:bg-accent"
                  >
                    <div className="flex w-full min-w-0 items-start gap-2.5 px-2.5 py-2 text-left">
                      <SearchHitContent hit={hit} />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Search className="size-3.5" />
              {total > 0 ? `${ui.search.total}: ${total}` : ui.search.openHint}
              <span className="ml-2 inline-flex items-center gap-1">
                <CornerDownLeft className="size-3" />
                {ui.search.openFullHint}
              </span>
            </span>
            <Button size="sm" variant="ghost" onClick={toWorkspace}>
              {total > shown ? `${ui.search.more} ${total - shown} · ` : ''}
              {ui.search.openFull}
            </Button>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
