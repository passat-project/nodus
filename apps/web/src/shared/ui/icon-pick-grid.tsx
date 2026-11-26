import type { ReactNode } from 'react';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Сетка выбора значка-идентичности (тип проекта, тип папки) — ОДНА сетка на
 * панель настроек, окна создания и экран типа (#857). Калибр плитки один:
 * сетка ограничена по ширине (`max-w-[21rem]`), поэтому на полной странице
 * ячейки не раздуваются до ~90px и не перетягивают внимание с названия
 * (что случалось с `grid-cols-8` на всю ширину), а в колонке панели ячейки
 * остаются долями ширины — восемь кнопок по 40px в неё не помещались.
 * Выбранная — рамка `border-ring` + ступень тона, как у остальных контролов.
 */
export function IconPickGrid<T extends string>({
  value,
  options,
  disabled,
  onSelect,
}: {
  value: T;
  /** `label` — имя для скринридера (русское), `title` — подсказка наведения. */
  options: readonly { value: T; label: string; title?: string; glyph: ReactNode }[];
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="grid w-full max-w-[21rem] grid-cols-8 gap-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(option.value)}
            aria-pressed={active}
            aria-label={option.label}
            title={option.title}
            className={cn(
              'flex aspect-square min-w-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-default',
              active
                ? 'border-ring bg-accent text-foreground'
                : 'border-border text-muted-foreground enabled:hover:border-input enabled:hover:text-foreground',
            )}
          >
            {option.glyph}
          </button>
        );
      })}
    </div>
  );
}
