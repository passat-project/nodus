import { useEffect, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';

import type { FilterFieldDef, FilterValue, NumberRangeValue } from './list-filters.js';

/** Диапазон чисел (кастомные «Число», «Деньги», «Продолжительность», #431):
 *  у продолжительности ввод и показ — «ч:мм», хранение — минуты. */
export function NumberRangeControl<T>({
  def,
  value,
  onChange,
}: {
  def: FilterFieldDef<T>;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const range: NumberRangeValue =
    typeof value === 'object' && value !== undefined ? (value as NumberRangeValue) : {};
  const duration = def.numberFormat === 'duration';
  const [fromText, setFromText] = useState(
    duration
      ? range.from !== undefined
        ? formatDurationFilter(range.from)
        : ''
      : (range.from ?? '').toString(),
  );
  const [toText, setToText] = useState(
    duration
      ? range.to !== undefined
        ? formatDurationFilter(range.to)
        : ''
      : (range.to ?? '').toString(),
  );

  // Пресет/«Сбросить» меняют значение снаружи — поля догоняют (иначе чип
  // активен, а ввод пустой). Сравниваем по разобранным значениям.
  useEffect(() => {
    if (parse(fromText) !== range.from) {
      setFromText(
        duration && range.from !== undefined
          ? formatDurationFilter(range.from)
          : (range.from ?? '').toString(),
      );
    }
    if (parse(toText) !== range.to) {
      setToText(
        duration && range.to !== undefined
          ? formatDurationFilter(range.to)
          : (range.to ?? '').toString(),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- текст — локальный ввод
  }, [range.from, range.to, duration]);

  const parse = (text: string): number | undefined => {
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    if (duration) return parseDurationFilter(trimmed);
    const normalized = trimmed.replace(/[\s\u00a0]/g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : undefined;
  };

  const emit = (from: string, to: string) => {
    const next = { from: parse(from), to: parse(to) };
    onChange(next.from === undefined && next.to === undefined ? undefined : next);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-body-xs text-muted-foreground">{def.label}</span>
      <Input
        value={fromText}
        inputMode={duration ? 'text' : 'decimal'}
        placeholder={ui.filters.numberFrom}
        aria-label={`${def.label}: ${ui.filters.numberFrom}`}
        onChange={(e) => {
          setFromText(e.target.value);
          emit(e.target.value, toText);
        }}
        className="h-8 flex-1 text-sm tabular-nums"
      />
      <Input
        value={toText}
        inputMode={duration ? 'text' : 'decimal'}
        placeholder={ui.filters.numberTo}
        aria-label={`${def.label}: ${ui.filters.numberTo}`}
        onChange={(e) => {
          setToText(e.target.value);
          emit(fromText, e.target.value);
        }}
        className="h-8 flex-1 text-sm tabular-nums"
      />
    </div>
  );
}

/** «ч:мм» → минуты; минуты только 0…59 («1:75» — не продолжительность). */
export function parseDurationFilter(text: string): number | undefined {
  const match = /^(\d{1,5})(?::(\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;
  const minutes = match[2] ? Number(match[2]) : 0;
  if (minutes > 59) return undefined;
  return Number(match[1]) * 60 + minutes;
}

function formatDurationFilter(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
