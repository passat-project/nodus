import { Clock, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { parseTime, timeSlots } from './date-time-grid.js';

/** Шаг сетки времени: 15 минут — рабочий день живёт получасами; точное
 *  значение вводится руками в поле над сеткой. */
const SLOT_STEP = 15;
const SLOTS = timeSlots(SLOT_STEP);

/** Маска ввода «ЧЧ:ММ»: только цифры, двоеточие ставится само.
 *  «945» → «9:45», «0930» → «09:30» — набирать можно без ведущего нуля. */
function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits[0]}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * Выбор времени в стиле Nodus (#923): поле-триггер с часами открывает
 * поповер — поле точного ввода «ЧЧ:ММ» и сетка слотов с фиксированной
 * высотой (не прыгает при выборе), выбранный слот подсвечен и прокручен в
 * центр. Клик по слоту закрывает поповер; Enter в поле — тоже. Нативные
 * `type="time"` запрещены каноном (окно браузера не в нашем UI).
 */
export function TimePicker({
  value,
  onChange,
  ariaLabel,
  placeholder = ui.common.notSet,
}: {
  /** «HH:MM» или null — не задано. */
  value: string | null;
  onChange: (value: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const selectedRef = useRef<HTMLButtonElement>(null);
  const firstSlotRef = useRef<HTMLButtonElement>(null);

  // Открытие: черновик из значения, выбранный слот — в центр списка.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setDraft(value ?? '');
  }
  useEffect(() => {
    if (!open) return;
    selectedRef.current?.scrollIntoView?.({ block: 'center' });
  }, [open]);

  const selected = useMemo(() => (value && parseTime(value) ? value : null), [value]);

  function commit(next: string) {
    const parsed = parseTime(next);
    if (!parsed) return;
    // Сервер принимает строго «HH:MM» (схема workdayStart): «9:45» из ручного
    // ввода нормализуем в «09:45», иначе PATCH отваливается 400 (#923).
    onChange(`${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`);
    setOpen(false);
  }

  function commitDraft() {
    const parsed = parseTime(draft);
    if (parsed) commit(draft);
    else setDraft(value ?? '');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors hover:bg-accent/40 dark:bg-transparent"
        >
          <Clock className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <span
            className={cn('min-w-0 flex-1 truncate text-left', !value && 'text-muted-foreground')}
          >
            {value ?? placeholder}
          </span>
          {value ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={ui.filters.reset}
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
              }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" strokeWidth={1.75} />
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-2"
        // Автофокус Radix фокусирует первое поле и выделяет его текст — на
        // открытии ничего выделяться не должно (вердикт 18.11.2026): фокус
        // ставим на выбранный слот (стрелки/Enter работают с ним), поле
        // времени пользователь берёт кликом.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (selectedRef.current ?? firstSlotRef.current)?.focus({ preventScroll: true });
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(maskTime(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            }
          }}
          onBlur={commitDraft}
          aria-label={ui.common.timeLabel}
          placeholder={ui.common.timePlaceholder}
          className="h-8 text-center tabular-nums"
          inputMode="numeric"
        />
        <div className="mt-2 h-52 overflow-y-auto rounded-lg">
          {SLOTS.map((slot) => (
            <button
              key={slot}
              ref={slot === selected ? selectedRef : slot === SLOTS[0] ? firstSlotRef : undefined}
              type="button"
              onClick={() => commit(slot)}
              className={cn(
                'flex h-7 w-full items-center rounded-md px-2.5 text-left text-sm tabular-nums transition-colors hover:bg-accent',
                slot === selected && 'bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {slot}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
