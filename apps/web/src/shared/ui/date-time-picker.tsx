import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import {
  formatDateRu,
  monthGridCells,
  parseTime,
  quickOptionDate,
  type QuickOptionId,
} from './date-time-grid.js';

const dayMonthFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const monthYearFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const weekdayDayFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const QUICK: { id: QuickOptionId; label: string }[] = [
  { id: 'today', label: ui.common.dateToday },
  { id: 'tomorrow', label: ui.common.dateTomorrow },
  { id: 'endOfWeek', label: ui.common.dateEndOfWeek },
  { id: 'inAWeek', label: ui.common.dateInAWeek },
  { id: 'endOfMonth', label: ui.common.dateEndOfMonth },
];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Время значения для подписи триггера: НЕ локальный ввод поповера (timeStr),
 *  иначе внешний префилл/повторный монтаж показывали бы дефолтные 17:00. */
function valueTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

/**
 * Выбор даты-времени крайнего срока в стиле Nodus (вердикт владельца
 * 15.09.2026: нативный `datetime-local` — «ужас из 2000-х», не в нашем
 * стиле). Модель Битрикс24: триггер-поле → поповер с сеткой месяца,
 * колонкой быстрых вариантов (Сегодня/Завтра/В конце недели/…) и полем
 * времени (дефолт 17:00 — конец рабочего дня). Логика сетки — чистая
 * `date-time-grid.ts` (unit-тесты). Потребитель: экспресс-форма задачи
 * (`shared/tasks`), далее — все формы со сроками.
 */
export function DateTimePicker({
  value,
  onChange,
  ariaLabel,
  placeholder = ui.common.noDeadline,
  children,
  clearLabel,
  withTime = true,
  format = 'short',
}: {
  value: Date | null;
  onChange: (value: Date | null) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Свой триггер (поле карточки — чип срока вместо полноширинного поля). */
  children?: ReactNode;
  /** Кнопка очистки внутри поповера (у своего триггера крестика нет). */
  clearLabel?: string;
  /** false — «только дата» (кастомные поля типа «Дата», #431): без поля
   *  времени, значение — локальная полночь выбранного дня. */
  withTime?: boolean;
  /** Подпись триггера «только даты»: short — «12 января» (сроки), full —
   *  «12.01.1990» (даты рождения и приёма: год обязателен, #923). */
  format?: 'short' | 'full';
}) {
  const [open, setOpen] = useState(false);
  // «Сейчас» — на момент открытия поповера (подсветка today, быстрые варианты).
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [timeStr, setTimeStr] = useState('17:00');
  // Сетка выбора года (клик по «Месяц Год»): по умолчанию выключена, при
  // открытии поповера сбрасывается — сначала всегда календарь месяца.
  const [yearMode, setYearMode] = useState(false);

  // При каждом открытии — вид на месяц значения (или текущий), время значения.
  // Сброс во время рендера по переходу open (канон React, аудит #45).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      const base = value ?? new Date();
      setNow(new Date());
      setView({ year: base.getFullYear(), month: base.getMonth() });
      setYearMode(false);
      setTimeStr(
        value
          ? `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
          : '17:00',
      );
    }
  }

  const cells = useMemo(() => monthGridCells(view.year, view.month), [view]);
  // Блок из 16 лет (4×4, во всю высоту сетки месяца): клик по году в шапке;
  // стрелки листают блок целиком — до 1980-х два клика с пустой даты.
  const yearBlockStart = Math.floor(view.year / 16) * 16;
  const years = useMemo(
    () => Array.from({ length: 16 }, (_, i) => yearBlockStart + i),
    [yearBlockStart],
  );

  function commit(day: Date) {
    if (!withTime) {
      onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0));
      setOpen(false);
      return;
    }
    const time = parseTime(timeStr) ?? { hours: 17, minutes: 0 };
    onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hours, time.minutes));
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = new Date(v.year, v.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  /** Стрелки в режиме года листают блок из 16 лет. */
  function shiftYearBlock(delta: number) {
    setView((v) => ({ ...v, year: v.year + delta }));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild aria-label={children ? ariaLabel : undefined}>
        {children ?? (
          <button
            type="button"
            aria-label={ariaLabel}
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors hover:bg-accent/40 dark:bg-transparent"
          >
            <Calendar className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span
              className={cn('min-w-0 flex-1 truncate text-left', !value && 'text-muted-foreground')}
            >
              {value
                ? withTime
                  ? `${dayMonthFmt.format(value)} ${valueTime(value)}`
                  : format === 'full'
                    ? formatDateRu(value)
                    : dayMonthFmt.format(value)
                : placeholder}
            </span>
            {value ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label={ui.filters.reset}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" strokeWidth={1.75} />
              </span>
            ) : null}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex gap-3">
          <div className="w-60 shrink-0">
            <div className="flex items-center justify-between pb-1.5">
              <button
                type="button"
                onClick={() => (yearMode ? shiftYearBlock(-16) : shiftMonth(-1))}
                aria-label="‹"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="size-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setYearMode((mode) => !mode)}
                aria-expanded={yearMode}
                aria-label={ui.common.pickYear}
                className="rounded-md px-1.5 py-0.5 text-sm font-medium transition-colors first-letter:uppercase hover:bg-accent"
              >
                {yearMode
                  ? `${yearBlockStart} – ${yearBlockStart + 15}`
                  : monthYearFmt.format(new Date(view.year, view.month, 1))}
              </button>
              <button
                type="button"
                onClick={() => (yearMode ? shiftYearBlock(16) : shiftMonth(1))}
                aria-label="›"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronRight className="size-4" strokeWidth={1.75} />
              </button>
            </div>
            {yearMode ? (
              <div className="grid h-[13rem] grid-cols-4 grid-rows-4 gap-0.5">
                {years.map((year) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => {
                      setView((v) => ({ ...v, year }));
                      setYearMode(false);
                    }}
                    className={cn(
                      'flex h-full items-center justify-center rounded-md text-sm tabular-nums transition-colors hover:bg-accent',
                      year === view.year && 'bg-primary text-primary-foreground hover:bg-primary',
                      year === now.getFullYear() &&
                        year !== view.year &&
                        'font-semibold text-primary',
                    )}
                  >
                    {year}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-0.5">
                {ui.common.weekdaysShort.map((d) => (
                  <span
                    key={d}
                    className="flex h-7 items-center justify-center text-label-sm font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    {d}
                  </span>
                ))}
                {cells.map((cell) => {
                  const selected = value !== null && sameDay(cell.date, value);
                  const today = sameDay(cell.date, now);
                  const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
                  return (
                    <button
                      key={cell.date.toISOString()}
                      type="button"
                      onClick={() => commit(cell.date)}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-md text-sm tabular-nums transition-colors hover:bg-accent',
                        !cell.inMonth && 'text-muted-foreground/50',
                        cell.inMonth && weekend && !selected && 'text-muted-foreground',
                        today && !selected && 'font-semibold text-primary',
                        selected && 'bg-primary text-primary-foreground hover:bg-primary',
                      )}
                    >
                      {cell.date.getDate()}
                    </button>
                  );
                })}
              </div>
            )}
            {withTime ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {ui.common.timeLabel}
                </span>
                <Input
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                  aria-label={ui.common.timeLabel}
                  className="h-7 w-20 text-sm tabular-nums"
                />
              </div>
            ) : null}
          </div>
          <div className="flex w-44 shrink-0 flex-col gap-1 border-l border-border pl-3">
            {QUICK.map((q) => {
              const date = quickOptionDate(q.id, now);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => commit(date)}
                  className="rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="block text-sm">{q.label}</span>
                  <span className="block text-label text-muted-foreground first-letter:uppercase">
                    {weekdayDayFmt.format(date)}
                  </span>
                </button>
              );
            })}
            {clearLabel && value ? (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="mt-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={1.75} />
                {clearLabel}
              </button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
