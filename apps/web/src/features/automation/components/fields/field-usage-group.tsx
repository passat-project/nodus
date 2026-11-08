import type { ReactNode } from 'react';
import { Calculator, Check, ChevronDown, Minus } from 'lucide-react';
import type { FormulaHostKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/** Группа «Где используется» (#631, Р11): модуль с раскрытием до типов и
 *  видов, подписи целей (#630). Вынесено из field-usage-picker.tsx (I5). */

export interface Target {
  id: string;
  name: string;
}

/** Подпись под целью привязки (#630, счётчик): «Выдаёт кнопка …» или
 *  причина несовместимости. `blocked` — новую отметку поставить нельзя
 *  (уже отмеченная остаётся снимаемой — иначе её не убрать). */
export interface TargetNote {
  text: string;
  tone: 'muted' | 'warn' | 'danger';
  blocked: boolean;
}

export type DescribeTarget = (
  group: FormulaHostKind,
  targetId: string,
  on: boolean,
) => TargetNote | null;

/** Индикатор выбора — ведущий, у самого названия (как в FieldTypesPicker). */
export function Mark({ state }: { state: 'on' | 'off' | 'some' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border transition-colors',
        state === 'off' ? 'border-input' : 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {state === 'on' ? <Check className="size-3" strokeWidth={2.5} /> : null}
      {state === 'some' ? <Minus className="size-3" strokeWidth={2.5} /> : null}
    </span>
  );
}

export function Group({
  label,
  targets,
  selected,
  expanded,
  onToggleExpand,
  onToggleAll,
  onToggleOne,
  disabled,
  allowFormulas,
  onEditFormula,
  describe,
  action,
}: {
  describe?: (targetId: string, on: boolean) => TargetNote | null;
  /** Элемент справа в строке отмеченной цели (способ выдачи номера, #630). */
  action?: (targetId: string) => ReactNode;
  label: string;
  targets: readonly Target[];
  selected: ReadonlySet<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
  disabled: boolean;
  allowFormulas: boolean;
  onEditFormula: (target: Target) => void;
}) {
  const chosen = targets.filter((target) => selected.has(target.id));
  const state = chosen.length === 0 ? 'off' : chosen.length === targets.length ? 'on' : 'some';
  const expandable = targets.length > 0;
  return (
    <div className="rounded-lg border border-input">
      {/* Строка группы: чекбокс «все» — сам по себе (клик по нему не
          раскрывает и не сбрасывает выбор), клик по остальной строке —
          раскрытие/сворачивание (вердикт владельца 06.11: случайный клик по
          строке не должен терять выбранные типы). Ховер раскрытия — до
          правого края, включая шеврон. */}
      {/* Ховер — один на всю строку (чекбокс + название + шеврон), как у
          строки списка; чекбокс поверх добавляет свой акцент. */}
      <div
        className={cn(
          'flex items-stretch rounded-t-lg transition-colors',
          expandable && 'hover:bg-accent/40',
          !expanded && 'rounded-b-lg',
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={state === 'some' ? 'mixed' : state === 'on'}
          aria-label={label}
          disabled={disabled || !expandable}
          onClick={onToggleAll}
          className="flex w-9 shrink-0 items-center justify-center rounded-l-lg text-secondary-foreground transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Mark state={state} />
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={!expandable}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-r-lg py-2 pr-1.5 pl-0.5 text-left text-sm text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {chosen.length}/{targets.length}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
            strokeWidth={1.75}
          />
        </button>
      </div>
      {expanded && expandable ? (
        <div className="flex flex-col gap-0.5 border-t py-1.5">
          {targets.map((target) => {
            const on = selected.has(target.id);
            const note = describe?.(target.id, on) ?? null;
            const blocked = !on && note?.blocked === true;
            return (
              <div
                key={target.id}
                className={cn(
                  'mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-1 rounded-md pr-0.5 transition-colors',
                  !(disabled || blocked) && 'hover:bg-accent/60',
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={disabled || blocked}
                  title={blocked ? note?.text : undefined}
                  onClick={() => onToggleOne(target.id)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-sm',
                    on ? 'text-foreground' : 'text-secondary-foreground',
                    (disabled || blocked) && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Mark state={on ? 'on' : 'off'} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{target.name}</span>
                    {note && (on || blocked) ? (
                      <span
                        className={cn(
                          'truncate text-xs',
                          note.tone === 'danger'
                            ? 'text-danger'
                            : note.tone === 'warn'
                              ? 'text-warning'
                              : 'text-muted-foreground',
                        )}
                      >
                        {note.text}
                      </span>
                    ) : null}
                  </span>
                </button>
                {on && allowFormulas ? (
                  <button
                    type="button"
                    aria-label={ui.formulas.typeFormula.set}
                    title={ui.formulas.typeFormula.hint}
                    disabled={disabled}
                    onClick={() => onEditFormula(target)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Calculator className="size-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
                {on && action ? action(target.id) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
