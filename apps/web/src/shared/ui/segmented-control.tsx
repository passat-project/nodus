import { cn } from '@nodus/ui/lib/utils';

/**
 * Сегментированный переключатель — ОДИН примитив на всё приложение.
 *
 * Радиусы вложенных поверхностей концентрические: внутренний = внешний −
 * отступ − рамка. Иначе внутренняя кнопка выглядит «пилюлей» при квадратной
 * рамке (замечание владельца 25.10.2026). Формула — в CSS-переменных, чтобы
 * масштаб интерфейса (`--ui-scale`) не рассинхронизировал px:
 *   внешний  var(--radius-lg)            = 10px
 *   отступ   0.125rem                     = 2px (при scale 1.25 — 2.5px)
 *   рамка    1px
 *   внутренний calc(внешний − отступ − 1px)
 */
export const SEGMENTED_OUTER_RADIUS = 'var(--radius-lg)';
export const SEGMENTED_PADDING = '0.125rem';
export const SEGMENTED_BORDER = '1px';
export const SEGMENTED_INNER_RADIUS = `calc(${SEGMENTED_OUTER_RADIUS} - ${SEGMENTED_PADDING} - ${SEGMENTED_BORDER})`;

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  className,
  activeClassName,
  size = 'md',
  layout = 'flex',
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Активный сегмент: по умолчанию primary; переключатели-«пилюли» — accent. */
  activeClassName?: string;
  /** sm — компактные переключатели шапок (px-2 py-0.5). */
  size?: 'sm' | 'md';
  /** grid — равные сегменты по ширине САМОЙ ДЛИННОЙ подписи (w-max):
   *  длинные подписи («Управленческая») не обрезаются в узкой шапке. */
  layout?: 'flex' | 'grid';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        layout === 'grid' ? 'grid w-max auto-cols-fr grid-flow-col' : 'flex',
        'min-w-0 border border-border',
        className,
      )}
      style={{ borderRadius: SEGMENTED_OUTER_RADIUS, padding: SEGMENTED_PADDING }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          style={{ borderRadius: SEGMENTED_INNER_RADIUS }}
          className={cn(
            'min-w-0 flex-1 truncate text-xs transition-colors',
            size === 'sm' ? 'px-2 py-0.5' : 'px-2 py-1.5',
            value === option.value
              ? (activeClassName ?? 'bg-primary text-primary-foreground')
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
