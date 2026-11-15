import { Check, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CounterpartyRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useDebouncedValue } from '../lib/use-debounced-value.js';
import { useActiveOption } from '../ui/use-active-option.js';
import { useCreateCounterparty } from './mutations.js';
import { useCounterpartyOptions, useSimilarCounterparties } from './queries.js';
import { useCanCreateCounterparties } from './use-crm-permissions.js';

type Entry =
  { kind: 'pick'; ref: CounterpartyRef; unp: string | null; similar: boolean } | { kind: 'create' };

/**
 * Автокомплит контрагента из справочника (textbox с подсказками — модель
 * Битрикс24, тот же указательный гард Radix Popover, что у FilterCombobox):
 * серверный поиск по краткому/полному названию и УНП с задержкой 250 мс,
 * группа «Похожие» (нечёткое сходство — опечатки, кавычки) и создание
 * «на лету» одной строкой по праву `crm.create` (без права — подсказка, кто
 * может добавить; сервер — истина, I8). Архивные контрагенты видны в
 * «Похожих» с пометкой, но не выбираются. Клавиатура (#55, регистрация за
 * 30 секунд): ↑/↓ по вариантам, Enter — подсвеченный (по умолчанию первый,
 * «Галур» → Enter), Esc — закрыть. Живёт в shared: потребители —
 * корреспонденция (регистрация) и фича контрагентов (I6).
 */
export function CounterpartyCombobox({
  value,
  onChange,
  ariaLabel,
  className,
  placeholder = ui.counterparties.searchPlaceholder,
  id,
  invalid,
  describedBy,
  autoFocus,
  openOnFocus = true,
  onDismiss,
}: {
  value: CounterpartyRef | null;
  onChange: (ref: CounterpartyRef | null) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  id?: string;
  /** Подсветка ошибки поля (aria-invalid) и связь с текстом ошибки. */
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  /** Раскрывать ли список на авто-фокусе: окно регистрации фокусирует поле
   *  молча (приёмка 28.10 — ничего не раскрываем автоматически), список —
   *  по клику/вводу. */
  openOnFocus?: boolean;
  /** Список закрыт без выбора (клик мимо, Esc, уход фокуса) — правка по
   *  месту в карточке на этом выходит из режима ввода. */
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fromPointer = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = useDebouncedValue(text.trim(), 250);
  const { data: options = [] } = useCounterpartyOptions(query);
  const { data: similar = [] } = useSimilarCounterparties({ name: query, unp: '' });
  const create = useCreateCounterparty();
  const canCreate = useCanCreateCounterparties();

  const q = query.toLowerCase();
  const exact =
    q !== '' &&
    options.some((c) => c.shortName.toLowerCase() === q || c.fullName.toLowerCase() === q);
  const similarOnly =
    q !== '' && !exact ? similar.filter((m) => !options.some((o) => o.id === m.id)) : [];
  const canCreateInline = q !== '' && !exact && canCreate;

  const entries: Entry[] = [
    ...options.map((c) => ({
      kind: 'pick' as const,
      ref: { id: c.id, name: c.shortName },
      unp: c.unp,
      similar: false,
    })),
    ...similarOnly
      .filter((m) => m.archivedAt === null)
      .map((m) => ({
        kind: 'pick' as const,
        ref: { id: m.id, name: m.shortName },
        unp: m.unp,
        similar: true,
      })),
    ...(canCreateInline ? [{ kind: 'create' as const }] : []),
  ];
  const nav = useActiveOption(entries.length, `${open}:${query}:${entries.length}`);

  // Активная строка в поле зрения; `?.()` — jsdom тестов scrollIntoView не знает.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [nav.active]);

  function choose(ref: CounterpartyRef | null) {
    onChange(ref);
    setText('');
    setOpen(false);
  }

  // mutate + onSuccess, не mutateAsync: ошибку показывает onError мутации,
  // а отклонённый промис из onClick уходил бы необработанным (#317).
  function createInline() {
    const name = text.trim();
    if (!name || create.isPending) return;
    create.mutate(
      { fullName: name, shortName: name, unp: null, address: null },
      { onSuccess: (card) => choose({ id: card.id, name: card.shortName }) },
    );
  }

  function pick(index: number) {
    const entry = entries[index];
    if (!entry) return;
    if (entry.kind === 'create') createInline();
    else choose(entry.ref);
  }

  const archivedSimilar = similarOnly.filter((m) => m.archivedAt !== null);
  const optionClass = (index: number, selected: boolean) =>
    cn(
      'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent/60',
      index === nav.active && 'bg-accent/60',
      selected ? 'text-port' : 'text-secondary-foreground',
    );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setText('');
          onDismiss?.();
        }
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn('relative min-w-0 flex-1', className)}>
          <Input
            id={id}
            value={open ? text : (value?.name ?? '')}
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
                onDismiss?.();
                return;
              }
              nav.onKeyDown(e, { onPick: pick, onOpen: () => setOpen(true), enabled: open });
            }}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-expanded={open}
            aria-autocomplete="list"
            role="combobox"
            autoFocus={autoFocus}
            className={cn('h-8 w-full text-sm', value && !open ? 'pr-7' : '')}
          />
          {value && !open ? (
            <button
              type="button"
              onClick={() => choose(null)}
              aria-label={`${ui.filters.reset}: ${ariaLabel}`}
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
        className="max-h-72 w-(--radix-popover-anchor-width) overflow-y-auto p-1"
      >
        <div ref={listRef} role="listbox" aria-label={ariaLabel}>
          {entries.map((entry, index) => {
            if (entry.kind === 'create') {
              return (
                <button
                  key="create"
                  type="button"
                  data-active={index === nav.active || undefined}
                  disabled={create.isPending}
                  onClick={createInline}
                  className={cn(optionClass(index, false), 'text-info disabled:opacity-50')}
                >
                  <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">
                    {ui.counterparties.createInline} «{text.trim()}»
                  </span>
                </button>
              );
            }
            const selected = entry.ref.id === value?.id;
            const firstSimilar =
              entry.similar && entries.findIndex((e) => e.kind === 'pick' && e.similar) === index;
            return (
              <div key={entry.ref.id}>
                {firstSimilar ? <SimilarTitle /> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-active={index === nav.active || undefined}
                  onClick={() => choose(entry.ref)}
                  onPointerMove={() => nav.setActive(index)}
                  className={optionClass(index, selected)}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.ref.name}</span>
                  {entry.unp ? (
                    <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                      {entry.unp}
                    </span>
                  ) : null}
                  {selected ? <Check className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
                </button>
              </div>
            );
          })}

          {archivedSimilar.length > 0 ? (
            <>
              {entries.some((e) => e.kind === 'pick' && e.similar) ? null : <SimilarTitle />}
              {archivedSimilar.map((m) => (
                <div
                  key={m.id}
                  title={ui.counterparties.similarArchived}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{m.shortName}</span>
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-label-sm text-muted-foreground">
                    {ui.counterparties.similarArchived}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </div>

        {q !== '' && !exact && !canCreate ? (
          <p className="px-2 py-2 text-center text-xs text-muted-foreground">
            {ui.counterparties.noCreatePermission}
          </p>
        ) : null}

        {entries.length === 0 && archivedSimilar.length === 0 && q === '' ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {ui.counterparties.empty}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function SimilarTitle() {
  return (
    <div className="px-1.5 pt-2 pb-1 text-label-sm font-medium text-muted-foreground uppercase">
      {ui.counterparties.similarTitle}
    </div>
  );
}
