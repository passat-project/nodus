/**
 * Дата-чип (план docs/mvp/archive/chat-messages-plan.md): центрированный чип-разделитель
 * при смене дня — «Сегодня» / «Вчера» / «5 сентября». Метка — `formatDayLabel`
 * (message-groups.ts); сам чип — моно-мелочь на токенах, без хардкода строк.
 *
 * `kind='marker'` — служебная плашка того же вида, но НЕ дата (разделитель
 * непрочитанных): плавающая дата (#997) такие маркеры не читает.
 */
export function DayChip({ label, kind = 'date' }: { label: string; kind?: 'date' | 'marker' }) {
  const isDate = kind === 'date';
  return (
    <div
      role="separator"
      aria-label={label}
      data-day-chip={isDate ? '' : undefined}
      data-day-label={isDate ? label : undefined}
      className="flex justify-center"
    >
      <span className="rounded-full bg-muted/40 px-2 py-0.5 font-mono text-label-sm uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
