import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { LetterDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

import { fromIsoDate } from '../../../../shared/custom-fields/value-format.js';
import { DateTimePicker } from '../../../../shared/ui/date-time-picker.js';
import { useMenuFocusGuard } from '../../../../shared/ui/menu-focus-guard.js';
import { useReceiptMethods } from '../../api/letters-queries.js';
import { todayIso } from '../../lib/letter-format.js';
import { editLabel, notSet, valueButton } from './letter-value-bits.js';

/** Правка полей письма по месту (#55, U7): грамматика полей карточки задачи —
 *  значение строкой, ховер-подложка, без рамок; Esc гасит правку, а не
 *  карточку. Сохранение — оптимистично у хозяина (`useUpdateLetter`). */

/** Строка правки: ввод по месту — Enter/уход сохраняют, Esc — отмена;
 *  пустое значение обязательного поля — отмена (сервер его не примет). */
export function TextFieldValue({
  value,
  label,
  maxLength,
  editable,
  empty = notSet,
  mono = true,
  onCommit,
}: {
  value: string | null;
  label: string;
  maxLength: number;
  editable: boolean;
  /** Пустое значение (обязательное поле — предупреждающий тон). */
  empty?: ReactNode;
  /** Номера — моно; тема — обычный текст. */
  mono?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = value ? (
    <span className={cn('truncate', mono && 'font-mono text-label-sm tabular-nums')}>{value}</span>
  ) : (
    empty
  );
  if (!editable) return text;

  function commit() {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== value) onCommit(next);
  }

  return draft !== null ? (
    <input
      autoFocus
      value={draft}
      maxLength={maxLength}
      aria-label={editLabel(label)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
        }
      }}
      className={cn(
        '-mx-1 h-6 w-56 max-w-full rounded-md bg-accent/50 px-1 outline-none',
        mono ? 'font-mono text-label-sm' : 'text-sm',
      )}
    />
  ) : (
    <button
      type="button"
      className={cn(valueButton, !value && 'shrink-0')}
      aria-label={editLabel(label)}
      onClick={() => setDraft(value ?? '')}
    >
      {text}
    </button>
  );
}

/** Календарная дата (без времени): «Их дата» не позже сегодня, срок ответа
 *  не раньше сегодня — та же проверка, что у сервера (`checkLetterDates`),
 *  до отправки; нарушение — подсказка без запроса. */
export function DateFieldValue({
  value,
  label,
  editable,
  rule,
  clearLabel,
  display,
  onCommit,
  onRejected,
}: {
  value: string | null;
  label: string;
  editable: boolean;
  rule: 'not_future' | 'not_past';
  /** Сброс в календаре (необязательное поле). */
  clearLabel?: string;
  display: ReactNode;
  onCommit: (value: string | null) => void;
  onRejected: (reason: 'in_future' | 'in_past') => void;
}) {
  if (!editable) return <>{display}</>;
  return (
    <DateTimePicker
      value={value ? fromIsoDate(value) : null}
      withTime={false}
      ariaLabel={label}
      clearLabel={clearLabel}
      onChange={(date) => {
        const iso = date ? todayIso(date) : null;
        if (iso === value) return;
        const today = todayIso();
        if (iso && rule === 'not_future' && iso > today) return onRejected('in_future');
        if (iso && rule === 'not_past' && iso < today) return onRejected('in_past');
        onCommit(iso);
      }}
    >
      <button
        type="button"
        className={cn(valueButton, !value && 'shrink-0')}
        aria-label={editLabel(label)}
      >
        {display}
      </button>
    </DateTimePicker>
  );
}

/** Способ поступления — меню действующих элементов справочника (Р14). */
export function ReceiptMethodValue({
  letter,
  editable,
  empty = notSet,
  onCommit,
}: {
  letter: LetterDetail;
  editable: boolean;
  /** Пустое значение (обязательное поле — предупреждающий тон). */
  empty?: ReactNode;
  onCommit: (method: { id: string; name: string }) => void;
}) {
  const { data: methods = [] } = useReceiptMethods();
  // Быстрый клик в соседнее поле (тема письма) не должен терять правку из-за
  // возврата фокуса на триггер после закрытия меню (#599).
  const focusGuard = useMenuFocusGuard();
  const current = letter.receiptMethod;
  const text = current ? <span className="truncate">{current.name}</span> : empty;
  if (!editable) return text;
  return (
    <DropdownMenu onOpenChange={focusGuard.onOpenChange}>
      <DropdownMenuTrigger
        className={cn(valueButton, !current && 'shrink-0')}
        aria-label={editLabel(ui.letters.fields.receiptMethod)}
      >
        {text}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent {...focusGuard.contentProps} align="start" className="w-max min-w-44">
        {methods
          .filter((method) => method.isActive || method.id === current?.id)
          .map((method) => (
            <DropdownMenuItem
              key={method.id}
              onSelect={() =>
                method.id !== current?.id && onCommit({ id: method.id, name: method.name })
              }
              className={cn(method.id === current?.id && 'text-port')}
            >
              {method.name}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
