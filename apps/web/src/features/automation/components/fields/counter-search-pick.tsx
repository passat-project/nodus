import { useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@nodus/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Второй шаг выбора «Вести счёт отдельно для» (#630): вид папки или поле —
 * список с поиском вместо плоской простыни в общем селекте (видов и полей
 * будут десятки).
 */
export function CounterSearchPick({
  label,
  search,
  empty,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  search: string;
  empty: string;
  value: string | null;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-left text-sm transition-colors outline-none hover:bg-accent/40 focus-visible:border-ring disabled:opacity-50"
        >
          <span className="shrink-0 text-xs text-muted-foreground">{label}:</span>
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected?.name ?? '—'}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder={search} />
          <CommandList>
            <CommandEmpty>{empty}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={`${option.name} ${option.id}`}
                onSelect={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.id === value ? <Check className="size-3.5" strokeWidth={1.75} /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
