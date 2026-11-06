import { FilePlus2, Inbox, MailCheck, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { LetterBox, LetterListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { letterRows, useLettersInfinite } from '../../../shared/api/letters-list.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import { makeCardRowMenuItems } from '../../../shared/views/card-row-menu.js';
import { DataTable } from '../../../shared/views/data-table.js';
import {
  letterBuiltinPresets,
  useLetterFilterDefs,
} from '../../../shared/views/letter-filter-fields.js';
import { useLetterTableFields } from '../../../shared/views/letter-table-fields.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { usePrefetchLetter } from '../api/letters-queries.js';
import { LettersEmpty, LettersLoadError } from './letters-empty.js';
import { LettersHeader } from './letters-header.js';
import { ManualLetterDialog } from './manual-letter-dialog.js';

const journal = {
  new: {
    label: ui.letters.tabs.new,
    icon: MailCheck,
    empty: ui.letters.list.newEmpty,
    hint: ui.letters.list.newEmptyHint,
  },
  incoming: {
    label: ui.letters.tabs.incoming,
    icon: Inbox,
    empty: ui.letters.list.incomingEmpty,
    hint: ui.letters.list.incomingEmptyHint,
  },
  outgoing: {
    label: ui.letters.tabs.outgoing,
    icon: Send,
    empty: ui.letters.list.outgoingEmpty,
    hint: ui.letters.list.outgoingEmptyHint,
  },
} as const;

const letterKey = (letter: LetterListItem) => letter.id;

/**
 * Список писем вкладки (#55, U6; редизайн #56 — и «Новые»): каноническая
 * таблица shared/views (свой viewKey на вкладку — своя память колонок и
 * фильтров), курсорная подгрузка sentinel-ом, СЕРВЕРНЫЙ поиск (№, тема,
 * их №, корреспондент; задержка 250 мс, прежние строки — до ответа), поля
 * фильтра и пресеты «Мне адресованы» / «Срок ответа истёк» — локально по
 * загруженным страницам (у «Новых» пресетов нет — письма без адресата и
 * сроков). Создание — только в «Новых» (бумажное письмо; входящее из почты
 * приходит само). Строка — карточка письма поверх стека (префетч по
 * ховеру); у «Новых» тема несёт личную точку «я ещё не открывал»
 * (`letter-table-fields`).
 */
export function LettersTable({ box }: { box: LetterBox }) {
  const copy = journal[box];
  const viewKey = `letters.${box}`;
  const toolbar = useListToolbar(viewKey, box === 'new' ? [] : letterBuiltinPresets);
  const search = useDebouncedValue(toolbar.query.trim(), 250);
  const query = useLettersInfinite(box, { search: search || undefined });
  const serverRows = useMemo(() => letterRows(query.data), [query.data]);
  // Реестр колонок — хук: атрибуты писем (#632) приходят с сервера.
  const fields = useLetterTableFields({ box });
  const defs = useLetterFilterDefs(serverRows, { box });
  // Запрос уже применил сервер — локально только поля фильтра (иначе
  // совпадения по «их №» отсеялись бы клиентской подстрокой).
  const filter = useMemo<ActiveListFilter<LetterListItem>>(
    () => ({ defs, state: toolbar.filters, query: '' }),
    [defs, toolbar.filters],
  );
  const rows = useFilteredList(serverRows, filter);
  const openCard = useOpenCard();
  const prefetch = usePrefetchLetter();
  const [manualOpen, setManualOpen] = useState(false);

  const failed = query.isError && !query.data;
  const pristine = query.isSuccess && serverRows.length === 0 && !search;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LettersHeader
        count={query.isSuccess ? `${rows.length}${query.hasNextPage ? '+' : ''}` : undefined}
      >
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={defs}
          builtinPresets={box === 'new' ? [] : letterBuiltinPresets}
          searchPlaceholder={ui.letters.list.searchPlaceholder}
          // Закон кнопки создания (вердикт владельца 15.09.26): первый элемент
          // строки инструментов, СЛЕВА от поиска; бумажное письмо создают
          // только в очереди «Новые».
          left={
            box === 'new' ? (
              <Button onClick={() => setManualOpen(true)} className="shrink-0">
                <FilePlus2 data-icon="inline-start" />
                {ui.common.create}
              </Button>
            ) : undefined
          }
          right={<ViewSettings viewKey={viewKey} defs={fields} />}
        />
      </LettersHeader>
      <div className="min-h-0 flex-1">
        {failed ? (
          <LettersLoadError onRetry={() => void query.refetch()} />
        ) : pristine ? (
          <LettersEmpty icon={copy.icon} title={copy.empty} hint={copy.hint} />
        ) : (
          <DataTable
            viewKey={viewKey}
            defs={fields}
            rows={rows}
            rowKey={letterKey}
            isLoading={query.isLoading}
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
            label={copy.label}
            emptyTitle={ui.filters.notFound}
            onHoverRow={(letter) => prefetch(letter.id)}
            onOpenRow={(letter, rowEl) =>
              openCard({ kind: 'letter', id: letter.id }, rowEl.getBoundingClientRect())
            }
            rowMenu={(letter) => makeCardRowMenuItems({ kind: 'letter', id: letter.id }, openCard)}
          />
        )}
      </div>
      {box === 'new' ? (
        <ManualLetterDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          onCreated={(created) => openCard({ kind: 'letter', id: created.id })}
        />
      ) : null}
    </div>
  );
}
