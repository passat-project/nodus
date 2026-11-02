import { Check, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Автокомплит сотрудника (textbox с подсказками — та же модель и тот же
 * указательный гард Radix Popover, что у CounterpartyCombobox/FilterCombobox):
 * ввод фильтрует по имени и должности; выбор — руководитель/зам подразделения
 * в диалоге подразделения (#84). Без создания «на лету»: сотрудников приглашают
 * отдельным потоком (InviteDialog).
 */
export function EmployeeCombobox({
  value,
  onChange,
  ariaLabel,
  users,
  className,
  placeholder,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  ariaLabel: string;
  users: UserListItem[];
  className?: string;
  /** Подсказка в пустом поле; по умолчанию — aria-label (в форме лучше
   *  передать действие: «Начните вводить имя», иначе placeholder дублирует
   *  подпись поля). */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fromPointer = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const selected = users.find((u) => u.id === value) ?? null;
  const q = text.trim().toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          (u.positionName ?? '').toLowerCase().includes(q),
      )
    : users;

  function choose(id: string | null) {
    onChange(id);
    setText('');
    setOpen(false);
    anchorRef.current?.focus();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Гард указательного устройства: клик по элементу списка не должен
        // закрывать поповер раньше выбора (Radix dismiss по pointer-down).
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
            aria-label={ariaLabel}
            value={open ? text : (selected?.displayName ?? '')}
            placeholder={placeholder ?? ariaLabel}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className={cn('h-8 text-sm', selected && !open && 'pr-8')}
          />
        </PopoverAnchor>
        {selected && !open && (
          <button
            type="button"
            aria-label={ariaLabel}
            onClick={() => choose(null)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent
        align="start"
        className="max-h-60 w-(--radix-popover-trigger-width) overflow-auto p-1"
        onPointerDown={() => {
          fromPointer.current = true;
        }}
      >
        {filtered.length === 0 && (
          <span className="block px-2 py-1.5 text-xs text-muted-foreground">
            {ui.filters.notFound}
          </span>
        )}
        {filtered.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => choose(user.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{user.displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {user.positionName ?? ''}
              </span>
            </span>
            {user.id === value && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
