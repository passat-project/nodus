import { Check, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

/** Пункт справочника для выбора: id + название, вторая строка — уточнение
 *  (глава подразделения). Список ПЛОСКИЙ: уровни дерева отступами не рисуются
 *  (вердикт приёмки 18.11.2026), порядок дерева сохраняет источник. */
export interface ReferenceOption {
  id: string;
  label: string;
  secondary?: string | null;
}

/** Фильтр по названию и уточнению (регистронезависимо, ru-локаль). */
export function filterReferenceOptions(
  options: readonly ReferenceOption[],
  text: string,
): ReferenceOption[] {
  const q = text.trim().toLocaleLowerCase('ru');
  if (!q) return [...options];
  return options.filter(
    (option) =>
      option.label.toLocaleLowerCase('ru').includes(q) ||
      (option.secondary ?? '').toLocaleLowerCase('ru').includes(q),
  );
}

/**
 * Выбор из справочника одной моделью (#981): поле с поиском, список ПОД полем
 * высотой 240 px (≈7 строк) со своим скроллом, «Не выбрано» первым пунктом и
 * крестик сброса; пустой поиск — «Ничего не найдено».
 *
 * Поведение — канон контрола «Руководитель/Заместитель» (#768, вердикт
 * 13.11.2026): открытие — клик/ввод/ArrowDown (НЕ фокус: окно ставит фокус
 * программно и список «мигал»), Esc закрывает список, а не диалог, указательный
 * гард Radix не даёт раннему dismiss съесть выбор. Список всегда клампится в
 * viewport: у нижнего края окна переворачивается вверх, высота — не больше
 * доступного места (вердикт владельца 23.11.2026: списки «выезжали» за окно).
 */
export function ReferenceCombobox({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  allowClear = true,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  options: readonly ReferenceOption[];
  ariaLabel: string;
  /** Подсказка в пустом поле; по умолчанию — подпись поля. */
  placeholder?: string;
  /** «Не выбрано» и крестик сброса; обязательный выбор — false. */
  allowClear?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fromPointer = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.id === value) ?? null;
  const filtered = filterReferenceOptions(options, text);

  function choose(id: string | null) {
    onChange(id);
    setText('');
    setOpen(false);
    // Программное закрытие не проходит через onOpenChange: гард указателя
    // обязан сброситься здесь, иначе он «съест» следующий клик мимо списка.
    fromPointer.current = false;
    // Фокус — самому полю: ref висит на обёртке-`div`, `.focus()` на ней no-op.
    anchorRef.current?.querySelector('input')?.focus();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Указательный гард Radix: клик по пункту не закрывает поповер
        // раньше выбора (pointer-down dismiss).
        if (!next && fromPointer.current) {
          fromPointer.current = false;
          return;
        }
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <div ref={anchorRef} className={cn('relative', className)}>
        <PopoverAnchor asChild>
          <Input
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            value={open ? text : (selected?.label ?? '')}
            placeholder={placeholder ?? ariaLabel}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && open) {
                // Esc закрывает список, а не окно вокруг.
                event.stopPropagation();
                setOpen(false);
                setText('');
                fromPointer.current = false;
                return;
              }
              if (event.key === 'ArrowDown' && !open) {
                event.preventDefault();
                setOpen(true);
                return;
              }
              if (event.key === 'Enter' && open && filtered[0]) {
                event.preventDefault();
                choose(filtered[0].id);
              }
            }}
            className={cn('h-8 text-sm', allowClear && selected && !open && 'pr-8')}
          />
        </PopoverAnchor>
        {allowClear && selected && !open && (
          <button
            type="button"
            aria-label={ui.employees.clearSelection}
            onClick={() => choose(null)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent
        align="start"
        side="bottom"
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-(--radix-popover-trigger-width) overflow-hidden p-1"
        onPointerDown={() => {
          fromPointer.current = true;
        }}
      >
        <div
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          className="max-h-[min(15rem,var(--radix-popover-content-available-height))] overflow-y-auto"
        >
          {allowClear && (
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onClick={() => choose(null)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">{ui.employees.notSelected}</span>
              {value === null && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
            </button>
          )}
          {filtered.length === 0 && (
            <span className="block px-2 py-1.5 text-xs text-muted-foreground">
              {ui.filters.notFound}
            </span>
          )}
          {filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onClick={() => choose(option.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.secondary ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.secondary}
                  </span>
                ) : null}
              </span>
              {option.id === value && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
