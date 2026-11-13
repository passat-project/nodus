import { Check, Search } from 'lucide-react';
import { useDeferredValue, useState, type ReactNode } from 'react';
import type { UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useUsersSearch } from '../api/users-list.js';
import { withoutPatronymic } from '../lib/format.js';
import { PersonAvatar } from './person-avatar.js';

/**
 * Выбор сотрудника (модель Битрикс24 «Добавить»): поповер со строкой
 * поиска по справочнику (серверный фильтр, ввод не блокирует — deferred) и
 * списком с аватарами и должностью. Множественный режим (`multiple`) не
 * закрывается после выбора — удобно добавить нескольких подряд; выбранные
 * отмечены галочкой, повторный клик снимает (`onToggle`).
 */
export function PeoplePicker({
  selectedIds,
  excludeIds = [],
  onToggle,
  multiple = false,
  ariaLabel,
  children,
}: {
  selectedIds: readonly string[];
  /** Кого нельзя выбрать в этом поле (постановщик/ответственный и т.п.). */
  excludeIds?: readonly string[];
  /** Второй аргумент — выбранный человек: кастомным полям нужна ссылка для
   *  оптимистичной правки (имя и аватар до ответа сервера, #431). */
  onToggle: (userId: string, user?: UserListItem) => void;
  multiple?: boolean;
  ariaLabel: string;
  /** Триггер (кнопка «+» или текущее значение поля). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const search = useDeferredValue(text);
  const { data, isFetching } = useUsersSearch(open ? search : '');
  const selected = new Set(selectedIds);
  const excluded = new Set(excludeIds);
  const people = (data?.items ?? []).filter((u) => !excluded.has(u.id));

  // Сброс поиска при закрытии — во время рендера (канон React, аудит #45):
  // в одиночном режиме выбор закрывает поповер программно (`setOpen(false)`),
  // и onOpenChange Radix при этом не вызывается — иначе при повторном
  // открытии в поле оставался старый запрос.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) setText('');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild aria-label={ariaLabel}>
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={ui.common.searchPlaceholder}
            aria-label={ariaLabel}
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
        <div
          className={cn('max-h-64 overflow-y-auto', isFetching && 'opacity-70')}
          data-no-scrollbar
        >
          {people.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {ui.filters.notFound}
            </p>
          ) : (
            people.map((u) => {
              const on = selected.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    onToggle(u.id, u);
                    if (!multiple) setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/60',
                    on ? 'text-port' : 'text-secondary-foreground',
                  )}
                >
                  <PersonAvatar
                    name={u.displayName}
                    avatarUrl={u.avatarUrl}
                    className="size-6 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {withoutPatronymic(u.displayName)}
                    </span>
                    {u.positionName ? (
                      <span className="block truncate text-label-sm text-muted-foreground">
                        {u.positionName}
                      </span>
                    ) : null}
                  </span>
                  {on ? <Check className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
