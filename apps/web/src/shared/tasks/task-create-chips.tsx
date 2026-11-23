import { ListChecks, Timer } from 'lucide-react';
import { useId, useState } from 'react';
import type { CreationChip } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import { formatDuration, parseDuration } from '../lib/minutes.js';
import { withPlanned, type TaskCreateDraft } from './task-create-draft.js';

/**
 * Чипы-блоки внизу окна создания (#432, Р2): «Чек-лист» (лист поверх формы —
 * модель Битрикс24; лист рендерит окно, оно же гасит им Esc) и
 * «Планируемое время» (ввод деловой длительности). Включаются формой типа;
 * чип без значения — приглушён, со значением — счётчик или «2ч 30м».
 */
export function TaskCreateChips({
  chips,
  draft,
  onChange,
  onOpenChecklist,
}: {
  chips: readonly CreationChip[];
  draft: TaskCreateDraft;
  onChange: (draft: TaskCreateDraft) => void;
  onOpenChecklist: () => void;
}) {
  const [plannedOpen, setPlannedOpen] = useState(false);
  if (chips.length === 0) return null;

  const planned =
    draft.plannedMinutes !== null
      ? formatDuration(draft.plannedMinutes, ui.tasks.hoursShort, ui.tasks.minutesShort)
      : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.includes('checklist') ? (
        <button
          type="button"
          onClick={onOpenChecklist}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm transition-colors hover:bg-accent',
            draft.checklist.length > 0
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ListChecks className="size-3.5" strokeWidth={1.75} />
          {draft.checklist.length > 0 ? (
            <span className="font-mono text-label-sm tabular-nums">{draft.checklist.length}</span>
          ) : null}
          {ui.taskCreate.chips.checklist}
        </button>
      ) : null}

      {chips.includes('planned') ? (
        plannedOpen ? (
          <PlannedInput
            value={draft.plannedMinutes}
            onCommit={(minutes) => {
              onChange(withPlanned(draft, minutes));
              setPlannedOpen(false);
            }}
            onCancel={() => setPlannedOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlannedOpen(true)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm transition-colors hover:bg-accent',
              planned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Timer className="size-3.5" strokeWidth={1.75} />
            {planned ? (
              <span className="font-mono text-label-sm tabular-nums">{planned}</span>
            ) : null}
            {ui.taskCreate.chips.planned}
          </button>
        )
      ) : null}
    </div>
  );
}

/** Ввод планового времени: деловая длительность, Enter — сохранить, Esc —
 *  отмена ввода. `data-esc-local`: окно не закрывается этим Esc (Radix ловит
 *  его на document в capture раньше поля — гасит окно, см. gotchas). */
function PlannedInput({
  value,
  onCommit,
  onCancel,
}: {
  value: number | null;
  onCommit: (minutes: number | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(
    value !== null ? formatDuration(value, ui.tasks.hoursShort, ui.tasks.minutesShort) : '',
  );
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  // Неверный ввод не стираем молча (#963): держим текст, показываем причину.
  const commit = () => {
    const raw = text.trim();
    if (!raw) {
      onCommit(null);
      return;
    }
    const minutes = parseDuration(raw);
    if (minutes === null) {
      setInvalid(true);
      return;
    }
    onCommit(minutes);
  };
  return (
    // Подсказка — абсолютная (#967, ревью админа 19-20.11): строка ошибки не
    // должна ни растить окно, ни поднимать поле относительно соседнего чипа
    // «Чек-лист» — оба пузыря стоят в одной линии. Подсказка висит под
    // пузырём в свободном зазоре над кнопками и на раскладку не влияет.
    <div className="relative">
      <Input
        autoFocus
        data-esc-local
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={ui.tasks.plannedPlaceholder}
        aria-label={ui.tasks.plannedTime}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className={cn('h-8 w-40 font-mono text-label-sm', invalid && 'border-destructive')}
      />
      {invalid ? (
        <span
          id={errorId}
          role="alert"
          className="pointer-events-none absolute top-full left-0 z-10 mt-1 text-label-xs leading-tight whitespace-nowrap text-destructive"
        >
          {ui.tasks.minutesInvalid}
        </span>
      ) : null}
    </div>
  );
}
