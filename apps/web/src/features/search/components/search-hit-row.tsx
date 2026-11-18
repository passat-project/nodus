import type { SearchHit } from '@nodus/contracts';
import { SEARCH_SNIPPET_END, SEARCH_SNIPPET_START, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatListTimestamp } from '../../../shared/lib/format.js';
import { searchReasonLabel, searchTypeIcon, searchTypeLabel } from '../lib/search-labels.js';
import { SnippetText, snippetClassName } from './snippet-text.js';

/** Первая строка результата: у сообщения название строки — контекст беседы
 *  («чат задачи ПП-123»), у остальных — заголовок источника. */
export function searchHitPrimary(hit: SearchHit): string {
  if (hit.type === 'message') return hit.meta.conversationLabel;
  return hit.title;
}

/** Вторая строка: идентификаторы и контекст (номер, проект, корреспондент,
 *  автор, дата) — без сырых скоров. */
export function searchHitMeta(hit: SearchHit): string {
  switch (hit.type) {
    case 'task':
      return [
        hit.meta.number ? `ПП-${hit.meta.number}` : null,
        hit.meta.projectName,
        formatListTimestamp(hit.sourceCreatedAt),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'letter':
      return [
        hit.meta.regNumber,
        hit.meta.counterpartyName,
        formatListTimestamp(hit.sourceCreatedAt),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'message':
      return [hit.meta.authorName, formatListTimestamp(hit.meta.createdAt)]
        .filter(Boolean)
        .join(' · ');
    case 'project':
      return [hit.meta.code, formatListTimestamp(hit.sourceCreatedAt)].filter(Boolean).join(' · ');
    case 'employee':
      return [hit.meta.positionName, hit.meta.departmentName].filter(Boolean).join(' · ');
  }
}

interface SearchHitRowProps {
  hit: SearchHit;
  active?: boolean;
  /** Показывать причины совпадения (рабочее окно); палитра компактнее. */
  showReasons?: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

/** Сниппет, только если он не повторяет заголовок (у задачи без описания
 *  сервер отдаёт окно названия — дублировать строку незачем). */
export function searchHitSnippet(hit: SearchHit): string | null {
  const plain = hit.snippet
    .split(SEARCH_SNIPPET_START)
    .join('')
    .split(SEARCH_SNIPPET_END)
    .join('')
    .trim();
  if (plain === '' || plain === hit.title.trim()) return null;
  return hit.snippet;
}

/** Содержимое строки без интерактивной обёртки: используется и кнопкой
 *  рабочего окна, и `CommandItem` компактной палитры (вложенные button/option
 *  недопустимы). */
export function SearchHitContent({
  hit,
  showReasons = false,
}: Pick<SearchHitRowProps, 'hit' | 'showReasons'>) {
  const Icon = searchTypeIcon(hit.type);
  const snippet = searchHitSnippet(hit);
  const reasons = showReasons ? hit.reasons.slice(0, 3) : [];
  return (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{searchHitPrimary(hit)}</span>
          {hit.match === 'similar' ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
              {ui.search.matchSimilar}
            </span>
          ) : null}
        </span>
        {snippet !== null ? <SnippetText text={snippet} className={snippetClassName} /> : null}
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px">
            {searchTypeLabel(hit.type)}
          </span>
          <span className="truncate">{searchHitMeta(hit)}</span>
        </span>
        {reasons.length > 0 ? (
          <span className="flex flex-wrap gap-1 pt-0.5">
            {reasons.map((reason) => (
              <span
                key={reason}
                className="rounded-full border border-border/70 px-1.5 py-px text-[10px] text-muted-foreground"
              >
                {searchReasonLabel(reason)}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
}

export function SearchHitRow({
  hit,
  active = false,
  showReasons = false,
  onSelect,
  onOpen,
}: SearchHitRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onSelect}
      onClick={onOpen}
      className={cn(
        'flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <SearchHitContent hit={hit} showReasons={showReasons} />
    </button>
  );
}
