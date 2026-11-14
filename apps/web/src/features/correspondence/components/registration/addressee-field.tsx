import { Check, X } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useUsersSearch } from '../../../../shared/api/users-list.js';
import { withoutPatronymic } from '../../../../shared/lib/format.js';
import { PersonAvatar } from '../../../../shared/ui/person-avatar.js';
import { useActiveOption } from '../../../../shared/ui/use-active-option.js';
import { useLetterResolvers } from '../../api/letters-queries.js';

/**
 * Адресат письма (#55, Р13): ОДИН сотрудник; сверху — «Принимают решения»
 * (держатели `correspondence.resolve`), ниже — «Все сотрудники» (серверный
 * поиск справочника). Клавиатура как у корреспондента: «Шай» → Enter.
 */
export function AddresseeField({
  value,
  onChange,
  id,
  invalid,
  describedBy,
  autoFocus = false,
  placeholder = ui.letters.form.addresseePlaceholder,
  ariaLabel = ui.letters.fields.addressee,
  onDismiss,
  openOnFocus = true,
}: {
  value: UserRef | null;
  onChange: (user: UserRef | null) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Правка по месту в карточке: фокус в поле открывает список сразу. */
  autoFocus?: boolean;
  /** Подсказка поля: у приглашения в обсуждение свой смысл выбора (#56). */
  placeholder?: string;
  ariaLabel?: string;
  /** Закрытие без выбора (клик мимо, Escape) — правка по месту в карточке
   *  закрывает поле, как у подписанта (приёмка 28.10). */
  onDismiss?: () => void;
  /** Раскрывать ли список на авто-фокусе: окно приглашения открывает список
   *  только по клику/вводу — авто-фокус диалога распахивал его «в воздухе»
   *  до отрисовки самого окна (приёмка 28.10). */
  openOnFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fromPointer = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const search = useDeferredValue(text.trim());
  const { data: resolvers = [] } = useLetterResolvers();
  const { data: people } = useUsersSearch(open ? search : '');

  const q = search.toLowerCase();
  const top = resolvers.filter((user) => q === '' || user.displayName.toLowerCase().includes(q));
  const topIds = new Set(resolvers.map((user) => user.id));
  const rest: UserRef[] = (people?.items ?? [])
    .filter((user) => !topIds.has(user.id))
    .map((user) => ({ id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl }));
  const entries = [...top, ...rest];
  const nav = useActiveOption(entries.length, `${open}:${q}:${top.length}:${rest.length}`);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [nav.active]);

  function choose(user: UserRef | null) {
    // Возврат фокуса из поповера Radix — не повод открывать список снова:
    // после выбора адресата он оставался раскрытым и перехватывал Ctrl+Enter
    // (живая проверка #55). Следующий клик по полю снимет флаг.
    fromPointer.current = true;
    onChange(user);
    setText('');
    setOpen(false);
  }

  const renderOption = (user: UserRef, index: number) => {
    const selected = user.id === value?.id;
    return (
      <button
        key={user.id}
        type="button"
        role="option"
        aria-selected={selected}
        data-active={index === nav.active || undefined}
        onClick={() => choose(user)}
        onPointerMove={() => nav.setActive(index)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent/60',
          index === nav.active && 'bg-accent/60',
          selected ? 'text-port' : 'text-secondary-foreground',
        )}
      >
        <PersonAvatar
          name={user.displayName}
          avatarUrl={user.avatarUrl}
          className="size-5 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate">{withoutPatronymic(user.displayName)}</span>
        {selected ? <Check className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
      </button>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setText('');
          onDismiss?.();
        }
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative min-w-0">
          <Input
            id={id}
            value={open ? text : value ? withoutPatronymic(value.displayName) : ''}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-expanded={open}
            aria-autocomplete="list"
            role="combobox"
            autoComplete="off"
            autoFocus={autoFocus || undefined}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onPointerDown={() => {
              fromPointer.current = true;
            }}
            onFocus={() => {
              if (openOnFocus && !fromPointer.current) setOpen(true);
            }}
            onClick={() => {
              fromPointer.current = false;
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && open) {
                e.preventDefault();
                setOpen(false);
                return;
              }
              nav.onKeyDown(e, {
                onPick: (index) => {
                  const user = entries[index];
                  if (user) choose(user);
                },
                onOpen: () => setOpen(true),
                enabled: open,
              });
            }}
            className={cn('h-8 text-sm', value && !open && 'pr-7')}
          />
          {value && !open ? (
            <button
              type="button"
              onClick={() => choose(null)}
              aria-label={`${ui.filters.reset}: ${ui.letters.fields.addressee}`}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        className="w-(--radix-popover-anchor-width) p-1"
      >
        {/* Фиксированная высота зоны списка — поповер не прыгает при поиске. */}
        <div ref={listRef} role="listbox" aria-label={ariaLabel} className="h-64 overflow-y-auto">
          {top.length > 0 ? <GroupTitle label={ui.letters.form.resolversGroup} /> : null}
          {top.map((user, index) => renderOption(user, index))}
          {rest.length > 0 ? <GroupTitle label={ui.letters.form.allEmployeesGroup} /> : null}
          {rest.map((user, index) => renderOption(user, top.length + index))}
          {entries.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {ui.filters.notFound}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GroupTitle({ label }: { label: string }) {
  return (
    <div className="px-1.5 pt-2 pb-1 text-label-sm font-medium text-muted-foreground uppercase">
      {label}
    </div>
  );
}
