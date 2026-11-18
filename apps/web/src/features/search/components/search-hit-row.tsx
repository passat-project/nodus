import type { SearchHit } from '@nodus/contracts';
import { SEARCH_SNIPPET_END, SEARCH_SNIPPET_START, ui } from '@nodus/contracts';

import { formatListTimestamp } from '../../../shared/lib/format.js';
import { searchTypeIcon } from '../lib/search-labels.js';
import { SnippetText, snippetClassName } from './snippet-text.js';

/** Первая строка результата: у сообщения название строки — контекст беседы
 *  («чат задачи ПП-123»), у остальных — заголовок источника. */
export function searchHitPrimary(hit: SearchHit): string {
  if (hit.type === 'message') return hit.meta.conversationLabel;
  return hit.title;
}

/** Вторая строка: идентификаторы и контекст БЕЗ даты — дата стоит справа
 *  первой строки (вердикт владельца 18.11.2026: строка — два слоя текста). */
export function searchHitMeta(hit: SearchHit): string {
  switch (hit.type) {
    case 'task':
      return [hit.meta.number ? `ПП-${hit.meta.number}` : null, hit.meta.projectName]
        .filter(Boolean)
        .join(' · ');
    case 'letter':
      return [hit.meta.regNumber, hit.meta.counterpartyName].filter(Boolean).join(' · ');
    case 'message':
      return hit.meta.authorName ?? '';
    case 'project':
      return hit.meta.code ?? '';
    case 'employee':
      return [hit.meta.positionName, hit.meta.departmentName].filter(Boolean).join(' · ');
  }
}

/** Дата справа первой строки; у сотрудника даты-события нет. */
export function searchHitDate(hit: SearchHit): string | null {
  switch (hit.type) {
    case 'task':
    case 'letter':
    case 'project':
      return formatListTimestamp(hit.sourceCreatedAt);
    case 'message':
      return formatListTimestamp(hit.meta.createdAt);
    case 'employee':
      return null;
  }
}

/** Сниппет, только если он не повторяет первую строку (у задачи без описания
 *  сервер отдаёт окно названия — дублировать строку незачем). */
export function searchHitSnippet(hit: SearchHit): string | null {
  const plain = hit.snippet
    .split(SEARCH_SNIPPET_START)
    .join('')
    .split(SEARCH_SNIPPET_END)
    .join('')
    .trim();
  if (plain === '' || plain === searchHitPrimary(hit).trim()) return null;
  return hit.snippet;
}

/** Содержимое строки без интерактивной обёртки: используется `CommandItem`
 *  компактной палитры (вложенные button/option недопустимы). Два слоя:
 *  заголовок (с датой справа) и одна вторичная строка — сниппет найденного
 *  фрагмента, а если совпадение в названии — контекст источника. */
export function SearchHitContent({ hit }: { hit: SearchHit }) {
  const Icon = searchTypeIcon(hit.type);
  const snippet = searchHitSnippet(hit);
  const date = searchHitDate(hit);
  return (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] leading-[18px] font-medium">
            {searchHitPrimary(hit)}
          </span>
          {hit.match === 'similar' ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground">
              {ui.search.matchSimilar}
            </span>
          ) : null}
          {date !== null ? (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {date}
            </span>
          ) : null}
        </span>
        {snippet !== null ? (
          <SnippetText text={snippet} className={snippetClassName} />
        ) : (
          <span className="truncate text-xs leading-4 text-muted-foreground">
            {searchHitMeta(hit)}
          </span>
        )}
      </span>
    </>
  );
}
