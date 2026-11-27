import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { IconPickGrid } from './icon-pick-grid.js';

/**
 * Выбор значка-идентичности типа (ревизия UI v3, #857): кнопка-триггер с
 * текущим значком, именем и шевроном, по клику — поповер с общей сеткой
 * `IconPickGrid`. Образец триггера и поповера — переключатель разделов
 * «Настройки портала → ИИ-агент» (бордюр, иконка, шеврон с разворотом).
 * Сетка значков целиком в окне настроек распирала его по ширине; в поповере
 * она той же ширины, но раскрывается только по запросу. Выбор закрывает
 * поповер; `disabled` — значок показан как обычное поле (письмо, без права).
 */
export function IconPickPopover<T extends string>({
  value,
  ariaLabel,
  options,
  disabled,
  onSelect,
}: {
  value: T;
  /** Имя поля для скринридера («Значок»). */
  ariaLabel: string;
  options: readonly { value: T; label: string; title?: string; glyph: ReactNode }[];
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  const glyph = (
    <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
      {current?.glyph}
    </span>
  );
  const triggerClass =
    'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input px-2.5 text-left text-sm transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30';
  if (disabled) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel}: ${current?.label ?? value}`}
        className={cn(triggerClass, 'text-muted-foreground')}
      >
        {glyph}
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${ariaLabel}: ${current?.label ?? value}`}
          aria-expanded={open}
          className={cn(triggerClass, 'text-foreground hover:bg-accent/40')}
        >
          {glyph}
          <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-auto p-2">
        <IconPickGrid
          value={value}
          options={options}
          onSelect={(next) => {
            onSelect(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
