import { useId, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import { formatDuration, parseDuration } from '../../../lib/minutes.js';

/**
 * «Плановое время» в окне перехода (#380/#994): деловая длительность,
 * Enter/blur — применить, Esc — вернуть прежнее.
 *
 * Неверный ввод не применяется и НЕ теряется (как в чипе создания, #967):
 * текст остаётся в поле, под ним — ошибка, `aria-invalid`. Пустое поле —
 * осознанная очистка: значение уходит `null` и сервер снимает время.
 */
export function MinutesField({
  value,
  editable,
  onChange,
}: {
  value: number | null;
  editable: boolean;
  onChange: (minutes: number | null) => void;
}) {
  const format = (minutes: number | null) =>
    minutes === null ? '' : formatDuration(minutes, ui.tasks.hoursShort, ui.tasks.minutesShort);
  const [text, setText] = useState(() => format(value));
  /** Ошибка формата: текст держим, значение не отправляем. */
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();

  function commit() {
    const raw = text.trim();
    if (!raw) {
      setInvalid(false);
      if (value !== null) onChange(null);
      return;
    }
    const minutes = parseDuration(raw);
    if (minutes === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(format(minutes));
    if (minutes !== value) onChange(minutes);
  }

  function cancel() {
    setInvalid(false);
    setText(format(value));
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Input
        value={text}
        readOnly={!editable}
        placeholder={ui.tasks.plannedPlaceholder}
        aria-label={ui.tasks.plannedTime}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className={cn('h-8 w-40 text-sm', invalid && 'border-destructive')}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onBlur={() => editable && commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (editable) commit();
          }
          if (event.key === 'Escape') cancel();
        }}
      />
      {/* Место под строку ошибки зарезервировано: она не наезжает на подпись
          следующего поля и не двигает окно (#967, #994). */}
      <p className="min-h-6 text-label-xs leading-tight wrap-anywhere">
        {invalid ? (
          <span id={errorId} role="alert" className="text-destructive">
            {ui.tasks.minutesInvalid}
          </span>
        ) : null}
      </p>
    </div>
  );
}
