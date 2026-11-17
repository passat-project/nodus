import { useEffect, useRef, useState } from 'react';
import { ErrorCode, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';

import { ApiError } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';

/** Нормализация названия для проверки дубля: регистр, пробелы по краям и
 *  внутри (для пользователя «Ведущий  инженер» и «ведущий инженер» — одно). */
export function normalizePositionName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}

/**
 * Создание должности (#768, вердикт 13.11.2026): ввод спрятан в диалог кнопки
 * «Добавить», дубли проверяются ДО запроса (без учёта регистра) и показываются
 * в диалоге — раньше совпадение давало системный тост P2002 внизу справа.
 * Сервер повторяет проверку и восстанавливает ранее удалённую строку с тем же
 * именем (отдельного архива в интерфейсе нет).
 */
export function PositionCreateDialog({
  open,
  existingNames,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** Названия всех видимых должностей (активных) для проверки дубля. */
  existingNames: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError(null);
    setPending(false);
  }, [open]);

  async function submit() {
    if (pending) return;
    const value = name.trim();
    if (!value) {
      setError(ui.employees.positionNameRequired);
      inputRef.current?.focus();
      return;
    }
    if (existingNames.includes(normalizePositionName(value))) {
      setError(ui.employees.positionExists);
      return;
    }
    setPending(true);
    try {
      await onSubmit(value);
      onOpenChange(false);
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        (cause.code === ErrorCode.DIRECTORY_POSITION_EXISTS || cause.code === ErrorCode.CONFLICT)
      ) {
        setError(ui.employees.positionExists);
      } else {
        toastApiError(cause);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="w-full bg-card sm:max-w-sm">
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.positionCreateTitle}
        </DialogTitle>
        <div className="flex flex-col gap-1.5">
          <Input
            ref={inputRef}
            autoFocus
            value={name}
            aria-invalid={error !== null || undefined}
            aria-describedby={error ? 'position-create-error' : undefined}
            placeholder={ui.employees.positionNamePlaceholder}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
          />
          {error && (
            <span id="position-create-error" className="text-xs text-destructive">
              {error}
            </span>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            {ui.common.cancel}
          </Button>
          <Button disabled={pending} onClick={() => void submit()}>
            {ui.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
