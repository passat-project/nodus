import { cn } from '@nodus/ui/lib/utils';

/** Радиострока вида использования (Р7): атрибут записей / глобальная. */
export function KindOption({
  title,
  hint,
  on,
  disabled,
  onSelect,
}: {
  title: string;
  hint: string;
  on: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
        on ? 'border-primary/50 bg-accent/40' : 'border-input hover:bg-accent/25',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          on ? 'border-primary' : 'border-input',
        )}
      >
        {on ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">{title}</span>
        <span className="text-xs break-words text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
