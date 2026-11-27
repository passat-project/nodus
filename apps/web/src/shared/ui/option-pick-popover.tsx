import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Выбор значения из короткого списка кнопкой-триггером (ревизия UI v3,
 * #857): триггер канона — бордюр, текущее значение, шеврон с разворотом; по
 * клику — поповер со строками списка и галочкой у текущего. Образец —
 * переключатель разделов «Настройки портала → ИИ-агент». Заменяет сетку
 * кнопок с рамками («Тип папки»): та распирала окно настроек, здесь список
 * раскрывается только по запросу. Список — с фиксированным потолком высоты:
 * длинный справочник прокручивается внутри, окно не растёт.
 */
export function OptionPickPopover<T extends string>({
  value,
  ariaLabel,
  options,
  disabled,
  onSelect,
}: {
  value: T;
  ariaLabel: string;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  const triggerClass =
    'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input px-2.5 text-left text-sm transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30';
  if (disabled) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel}: ${current?.label ?? value}`}
        className={cn(triggerClass, 'text-muted-foreground')}
      >
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
      <PopoverContent align="start" sideOffset={6} className="w-64 p-1">
        <div className="max-h-64 overflow-y-auto" data-no-scrollbar>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
                  active ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {active ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
