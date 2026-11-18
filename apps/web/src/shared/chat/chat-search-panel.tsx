import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Funnel, Search, X } from 'lucide-react';
import { SEARCH_LIMITS, ui, type SearchRequest } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { SEARCH_PAGE_SIZE, searchHits, useSearchHits } from '../api/search.js';
import { useDebouncedValue } from '../lib/use-debounced-value.js';
import { formatDayLabel } from './message-groups.js';
import { FavoriteHitRow } from './favorite-hit-row.js';
import { useConversationMessages } from './chat-queries.js';
import { useFavoriteIds, useFavoriteLabels, useFavorites } from './favorites-api.js';
import { useJumpStore } from './jump-store.js';
import { filterNotesFlow, mergeNotesFlow, type NotesFilter } from './notes-flow.js';

/** Сколько строк показывать в «топ выдаче» (доработка релевантности — будущее). */
const TOP_N = 8;

/**
 * Панель поиска беседы (вердикт владельца 04.10, раунды 3–5; реф Битрикс24):
 * лупа в шапке раскрывает ПРАВУЮ панель — шапка-строка (назад/крестик +
 * пилюля поиска с лупой слева, очисткой и воронкой справа ВНУТРИ строки),
 * ниже — выдача (строки: полное имя, текст до 3 строк, вложения словами;
 * группировка заголовками дат по центру; звезда-заливка справа внизу);
 * воронка раскрывает фильтры «продолжением строки вниз». Поверх панели
 * вложений — «назад», standalone — крестик.
 *
 * Выдача (#956): в обычном чате/канале — ПОИСК ПО ВСЕМ СООБЩЕНИЯМ беседы
 * через единый поисковый контур (`/search` + `conversationId`, FTS-ранжирование,
 * сниппеты с подсветкой); клик — классический прыжок (jump-store). Раньше
 * здесь искалось только «Избранное» этого чата, что вводило в заблуждение.
 * В «Избранном» (беседа с собой) — прежний режим: записи и карточки витрины
 * с метками. Смонтирован всегда (активация — `active`); смена беседы —
 * сброс состояния.
 */
export function ChatSearchPanel({
  conversationId,
  isFavorites,
  active,
  overFiles,
  onBack,
  onClose,
  className,
}: {
  conversationId: string;
  /** Витрина «Избранного» (беседа с собой): поиск по записям и карточкам. */
  isFavorites: boolean;
  /** Вид активен (панель в режиме поиска): фокус строки без autoFocus. */
  active: boolean;
  /** Открыта ПОВЕРХ панели вложений — кнопка «назад» вместо крестика. */
  overFiles: boolean;
  onBack: () => void;
  onClose: () => void;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<NotesFilter>('all');
  const [labels, setLabels] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Смена беседы без ремаунта панели: состояние поиска — персонально беседе.
  useEffect(() => {
    setQ('');
    setFilter('all');
    setLabels([]);
    setFiltersOpen(false);
  }, [conversationId]);

  // Панель смонтирована всегда: фокус строки — при активации вида. Фокус
  // ПОСЛЕ выезда колонки (230мс > 200мс transition) и preventScroll:
  // фокус в кадре анимации дёргал скролл предков («гармошка», 04.10 р.6).
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 230);
    return () => window.clearTimeout(timer);
  }, [active, conversationId]);

  const { data: labelList } = useFavoriteLabels();
  const allLabels = labelList?.items ?? [];

  const messagesQuery = useConversationMessages(conversationId);
  const messages = useMemo(
    () => (messagesQuery.data?.items ?? []).filter((m) => !m.deletedAt),
    [messagesQuery.data],
  );
  // «Избранное» (беседа с собой) — прежний режим. В обычном чате закладки
  // НЕ грузятся: выдача там — поиск по сообщениям (#956).
  const favoritesQuery = useFavorites(isFavorites ? {} : { conversationId }, {
    enabled: isFavorites,
  });
  const cards = useMemo(
    () => (favoritesQuery.data?.pages ?? []).flatMap((page) => page.items),
    [favoritesQuery.data],
  );
  const needle = q.trim();
  // Debounce 250 мс: живой поиск не шлёт запрос на каждый символ.
  const debounced = useDebouncedValue(needle, 250);
  // Поиск сообщений беседы: единый контур /search + conversationId.
  const messageSearchRequest = useMemo<SearchRequest>(
    () => ({
      q: debounced,
      types: ['message'],
      conversationId,
      sort: 'newest',
      limit: SEARCH_PAGE_SIZE,
    }),
    [debounced, conversationId],
  );
  const messageSearch = useSearchHits(messageSearchRequest, {
    enabled: !isFavorites && active && debounced.length >= SEARCH_LIMITS.queryMin,
  });
  const messageHits = useMemo(() => searchHits(messageSearch.data), [messageSearch.data]);
  const favoriteIds = useFavoriteIds();

  const results = useMemo<SearchHit[]>(() => {
    const lower = needle.toLowerCase();
    if (isFavorites) {
      const entries = filterNotesFlow(
        mergeNotesFlow(messages, cards),
        filter,
        lower || null,
        labels,
      );
      return entries
        .slice(-TOP_N)
        .reverse()
        .map((entry): SearchHit =>
          entry.kind === 'note'
            ? {
                id: entry.message.id,
                kind: 'note',
                author: entry.message.author.displayName,
                snippet: entry.message.text,
                attachments: entry.message.attachments.map((a) => a.kind),
                date: entry.message.createdAt,
                threadRootId: null,
              }
            : {
                id: entry.card.messageId,
                kind: 'favorite',
                author: entry.card.author.displayName,
                snippet: entry.card.text,
                attachments: entry.card.attachments.map((a) => a.kind),
                date: entry.card.createdAt,
                threadRootId: null,
              },
        );
    }
    return [];
  }, [isFavorites, messages, cards, filter, labels, needle]);

  // Сообщения — в порядке `newest` сервера; сниппет с маркерами подсветки.
  // `conversationId` в hit сверяется с текущей беседой: keepPreviousData при
  // смене чата может отдать строки прошлой беседы — они не показываются.
  const messageResults = useMemo<SearchHit[]>(() => {
    if (isFavorites) return [];
    return messageHits.flatMap((hit) =>
      hit.type === 'message' && hit.meta.conversationId === conversationId
        ? [
            {
              id: hit.meta.messageId,
              kind: 'message' as const,
              author: hit.meta.authorName ?? ui.chat.searchUnknownAuthor,
              snippet: hit.snippet,
              attachments: [] as ('image' | 'file' | 'sticker')[],
              date: hit.meta.createdAt,
              threadRootId: hit.meta.threadRootId,
              favorited: favoriteIds.has(hit.meta.messageId),
            },
          ]
        : [],
    );
  }, [isFavorites, messageHits, favoriteIds, conversationId]);

  const shown = isFavorites ? results : messageResults;

  const filtersActive = filter !== 'all' || labels.length > 0;

  function jump(entry: { id: string; threadRootId: string | null }) {
    // Классический прыжок с подсветкой: лента/витрина скроллятся к
    // messageId, вспышка — штатная (jump-store + JumpResponder хоста).
    useJumpStore.getState().request(conversationId, entry.id, entry.threadRootId);
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col', className)}>
      {/* Шапка-строка поиска (та же высота, что бар хоста — линии
          border-b продолжают друг друга): [назад/крестик] [пилюля поиска]. */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        {overFiles ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 hover:bg-accent"
            onClick={onBack}
            aria-label={ui.chat.membersBack}
            title={ui.chat.membersBack}
          >
            <ArrowLeft />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 hover:bg-accent"
            onClick={onClose}
            aria-label={ui.common.close}
            title={ui.common.close}
          >
            <X />
          </Button>
        )}
        <span className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.75}
          />
          <input
            ref={inputRef}
            value={q}
            placeholder={
              isFavorites ? ui.chat.searchPlaceholder : ui.chat.searchMessagesPlaceholder
            }
            aria-label={isFavorites ? ui.chat.searchMessages : ui.chat.searchMessagesPlaceholder}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setQ('');
              }
            }}
            className={cn(
              // Тихий стиль приложения (композер/строки поиска): фон-muted
              // БЕЗ бордера и без рамки фокуса (белая рамка — «не наш стиль»,
              // вердикт 04.10 р.7).
              'h-8 w-full rounded-lg bg-muted/60 pl-7 text-sm outline-none transition-colors focus-visible:bg-muted',
              // Место под воронку (и ×-очистку) ВНУТРИ строки справа.
              isFavorites ? 'pr-[4.25rem]' : 'pr-8',
            )}
          />
          <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
            {q !== '' ? (
              <button
                type="button"
                aria-label={ui.chat.searchClear}
                title={ui.chat.searchClear}
                onClick={() => setQ('')}
                className="flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            ) : null}
            {/* Воронка — внутри строки (там, где есть фильтры: «Избранное»). */}
            {isFavorites ? (
              <button
                type="button"
                aria-label={ui.chat.searchFilters}
                aria-pressed={filtersActive}
                aria-expanded={filtersOpen}
                title={ui.chat.searchFilters}
                onClick={() => setFiltersOpen((v) => !v)}
                className={cn(
                  'ml-0.5 flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground',
                  filtersActive ? 'text-info' : 'text-muted-foreground',
                )}
              >
                <Funnel className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
          </span>
        </span>
      </div>

      {/* Расширение воронки — продолжение поисковой строки ВНИЗ (той же
          ширины): выезд grid-rows, как панель смайликов реакций. */}
      {isFavorites ? (
        <div
          className={cn(
            'grid shrink-0 transition-[grid-template-rows] duration-200 ease-out',
            filtersOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-2.5 border-b border-border px-3 py-2.5">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['notes', ui.chat.notesFilterNotes],
                    ['favorites', ui.chat.notesFilterFavorites],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(filter === value ? 'all' : value)}
                    aria-pressed={filter === value}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-body-xs transition-colors',
                      filter === value
                        ? 'bg-accent text-foreground'
                        : 'bg-muted/60 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {allLabels.length === 0 ? (
                <span className="text-xs text-muted-foreground/80">
                  {ui.chat.searchLabelsEmpty}
                </span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {allLabels.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() =>
                        setLabels((prev) =>
                          prev.includes(emoji)
                            ? prev.filter((label) => label !== emoji)
                            : [...prev, emoji],
                        )
                      }
                      aria-pressed={labels.includes(emoji)}
                      aria-label={emoji}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-sm leading-none transition-colors',
                        labels.includes(emoji)
                          ? 'bg-info-soft/60 text-info ring-1 ring-info/40'
                          : 'bg-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Выдача: клик — классический прыжок с подсветкой. Группировка
          заголовками дат по центру (реф Битрикс24), время в строках НЕ
          пишется; звезда-заливка — справа внизу строки. В обычном чате —
          все найденные сообщения беседы (сниппет с подсветкой, #956). */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {isFavorites && q.trim() === '' && !filtersActive && cards.length === 0 ? (
          <span className="flex flex-1 flex-col items-center justify-center gap-2 px-3 text-center">
            <Search className="size-8 text-muted-foreground/40" strokeWidth={1.5} />
            <span className="text-xs text-muted-foreground/80">{ui.chat.favoritesEmpty}</span>
          </span>
        ) : needle === '' && (!isFavorites || !filtersActive) ? (
          <span className="flex flex-1 flex-col items-center justify-center gap-2 px-3 text-center">
            <Search className="size-8 text-muted-foreground/40" strokeWidth={1.5} />
            <span className="text-xs text-muted-foreground/80">{ui.chat.searchHint}</span>
          </span>
        ) : !isFavorites && needle.length < SEARCH_LIMITS.queryMin ? (
          <span className="px-2 py-2 text-xs text-muted-foreground/80">
            {ui.chat.searchMinChars}
          </span>
        ) : !isFavorites && messageSearch.isError ? (
          <span className="px-2 py-2 text-xs text-muted-foreground/80">{ui.search.errorTitle}</span>
        ) : !isFavorites &&
          (messageSearch.isFetching || debounced !== needle) &&
          shown.length === 0 ? (
          <span className="px-2 py-2 text-xs text-muted-foreground/80">
            {ui.chat.searchLoading}
          </span>
        ) : shown.length === 0 ? (
          <span className="px-2 py-2 text-xs text-muted-foreground/80">
            {ui.chat.searchNoResults}
          </span>
        ) : (
          shown.map((entry, index) => {
            const prev = shown[index - 1];
            const day = formatDayLabel(entry.date);
            const newDay = prev === undefined || formatDayLabel(prev.date) !== day;
            return (
              <Fragment key={entry.id}>
                {newDay ? (
                  <span className="pb-1 pt-2 text-center text-xs text-muted-foreground">{day}</span>
                ) : null}
                <FavoriteHitRow
                  author={entry.author}
                  snippet={entry.snippet}
                  attachments={entry.attachments}
                  favorited={entry.favorited ?? entry.kind === 'favorite'}
                  highlightSnippet={!isFavorites}
                  onJump={() => jump(entry)}
                />
              </Fragment>
            );
          })
        )}
        {!isFavorites && messageSearch.hasNextPage ? (
          <button
            type="button"
            onClick={() => void messageSearch.fetchNextPage()}
            disabled={messageSearch.isFetchingNextPage}
            className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-60"
          >
            {messageSearch.isFetchingNextPage ? ui.chat.searchLoading : ui.search.showMore}
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface SearchHit {
  id: string;
  kind: 'note' | 'message' | 'favorite';
  author: string;
  snippet: string;
  attachments: ('image' | 'file' | 'sticker')[];
  date: string;
  threadRootId: string | null;
  /** Звезда-индикатор: у сообщений из поиска — реальная закладка (#956). */
  favorited?: boolean;
}
