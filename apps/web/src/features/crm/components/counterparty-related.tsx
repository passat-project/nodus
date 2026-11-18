import { useMemo } from 'react';
import type { LetterListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { letterRows, useLettersInfinite } from '../../../shared/api/letters-list.js';
import { useClientProjects } from '../../../shared/api/counterparty-relations.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import { makeCardRowMenuItems } from '../../../shared/views/card-row-menu.js';
import { DataTable } from '../../../shared/views/data-table.js';
import {
  letterBuiltinPresets,
  useLetterFilterDefs,
} from '../../../shared/views/letter-filter-fields.js';
import { useLetterTableFields } from '../../../shared/views/letter-table-fields.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useProjectTableFields } from '../../../shared/views/project-table-fields.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';

const LETTERS_VIEW = 'crm.letters';
const PROJECTS_VIEW = 'crm.projects';
const letterKey = (letter: LetterListItem) => letter.id;

/**
 * Вкладка «Письма» карточки контрагента (#460, #55) — обратная связь:
 * зарегистрированная переписка с организацией (оба направления, № несёт
 * префикс «Вх»/«Исх») на ОБЩЕМ реестре колонок и фильтров писем без колонки
 * «Корреспондент» (контекст очевиден; память колонок — своя). Поиск —
 * серверный, страницы — курсором. Письма здесь НЕ создаются: входящее
 * рождается в «Новых», корреспондент в нём — поле. Запрос идёт, только
 * когда вкладка открыта и домен отвечает (`enabled`). Клик — карточка
 * письма поверх стека.
 */
export function CounterpartyLettersTab({
  counterpartyId,
  enabled,
}: {
  counterpartyId: string;
  enabled: boolean;
}) {
  const openCard = useOpenCard();
  const toolbar = useListToolbar(LETTERS_VIEW, letterBuiltinPresets);
  const search = useDebouncedValue(toolbar.query.trim(), 250);
  const query = useLettersInfinite(
    null,
    { counterpartyId, search: search || undefined },
    { enabled },
  );
  const serverRows = useMemo(() => letterRows(query.data), [query.data]);
  const fields = useLetterTableFields({ counterpartyVisible: false });
  const defs = useLetterFilterDefs(serverRows, { counterpartyVisible: false });
  const filter = useMemo<ActiveListFilter<LetterListItem>>(
    () => ({ defs, state: toolbar.filters, query: '' }),
    [defs, toolbar.filters],
  );
  const rows = useFilteredList(serverRows, filter);
  const narrowed = search !== '' || rows.length < serverRows.length;
  return (
    <div className="flex h-full flex-col">
      <ListToolbar
        toolbar={toolbar}
        defs={defs}
        builtinPresets={letterBuiltinPresets}
        searchPlaceholder={ui.letters.list.searchPlaceholder}
        right={<ViewSettings viewKey={LETTERS_VIEW} defs={fields} />}
      />
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={LETTERS_VIEW}
          defs={fields}
          rows={rows}
          rowKey={letterKey}
          isLoading={enabled && query.isLoading}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          label={ui.counterparties.tabLetters}
          emptyTitle={narrowed ? ui.filters.notFound : ui.counterparties.noLetters}
          rowMenu={(letter) => makeCardRowMenuItems({ kind: 'letter', id: letter.id }, openCard)}
          onOpenRow={(letter, rowEl) =>
            openCard({ kind: 'letter', id: letter.id }, rowEl.getBoundingClientRect())
          }
        />
      </div>
    </div>
  );
}

/**
 * Вкладка «Проекты» карточки контрагента (#460) — проекты, где организация —
 * заказчик; единый реестр колонок проектов (память колонок — своя). Проекты
 * здесь не создаются: это редкое действие руководителя в модуле «Проекты»,
 * заказчик — поле проекта.
 */
export function CounterpartyProjectsTab({
  counterpartyId,
  enabled,
}: {
  counterpartyId: string;
  /** Вкладка открыта и домен проектов доступен (см. карточку). */
  enabled: boolean;
}) {
  const openCard = useOpenCard();
  const toolbar = useListToolbar(PROJECTS_VIEW);
  const search = useDebouncedValue(toolbar.query.trim(), 250);
  const { data, isLoading } = useClientProjects(counterpartyId, { enabled, search });
  // Поиск уже применил сервер (#956): клиентской подстроки здесь нет.
  const rows = data?.items ?? [];
  // Реестр колонок — хук: атрибуты портала (#632) приходят с сервера.
  const fields = useProjectTableFields();
  return (
    <div className="flex h-full flex-col">
      <ListToolbar
        toolbar={toolbar}
        defs={[]}
        right={<ViewSettings viewKey={PROJECTS_VIEW} defs={fields} />}
      />
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={PROJECTS_VIEW}
          defs={fields}
          rows={rows}
          rowKey={(project) => project.id}
          isLoading={isLoading}
          emptyTitle={ui.counterparties.noProjects}
          rowMenu={(project) => makeCardRowMenuItems({ kind: 'project', id: project.id }, openCard)}
          onOpenRow={(project, rowEl) =>
            openCard({ kind: 'project', id: project.id }, rowEl.getBoundingClientRect())
          }
        />
      </div>
    </div>
  );
}
