import type { RefObject } from 'react';
import type { CustomFieldDefinition, FormulaValidationIssue } from '@nodus/contracts';
import { FORMULA_LIMITS, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { CircleAlert } from 'lucide-react';

import { issueText } from './formula-preview.js';

/** Автодополнение по имени атрибута (состояние — в `useFormulaEditor`). */
export interface FormulaAutocompleteState {
  open: boolean;
  items: readonly CustomFieldDefinition[];
}

/**
 * Строка формулы и её состояние (#632, §4c): contenteditable с плашками,
 * подсказка пустого поля ВНУТРИ контроля, выпадашка автодополнения, результат
 * и лимиты одной строкой, ошибка — плашкой. Разметка без состояния: всё
 * приходит из редактора, поэтому окно остаётся представлением.
 *
 * Высоту держим стабильной: результат/ошибка живут в одной строке статуса,
 * иначе окно прыгает на каждом символе набора.
 */
export function FormulaLine({
  rootRef,
  empty,
  error,
  resultText,
  resultEmpty,
  issues,
  autocomplete,
  onInput,
  onKeyDown,
  onInsertText,
  onApplyAutocomplete,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  empty: boolean;
  error: string | null;
  resultText: string;
  resultEmpty: boolean;
  issues: readonly FormulaValidationIssue[];
  autocomplete: FormulaAutocompleteState;
  onInput: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  onInsertText: (text: string) => void;
  onApplyAutocomplete: (definition: CustomFieldDefinition) => void;
}) {
  return (
    <div className="shrink-0">
      {/* Единственный контрол окна с рамкой: поле должно читаться полем
          (фокус — канон ring). «=» появляется вместе с первым символом:
          подсказка пустого поля и так начинается со знака равенства. */}
      <div className="rounded-xl border border-input bg-card px-3 py-2.5 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30">
        <div className="flex items-start gap-2">
          {empty ? null : (
            <span
              aria-hidden
              className="mt-px shrink-0 font-mono text-xs leading-6 text-muted-foreground/70"
            >
              =
            </span>
          )}
          <div className="relative min-w-0 flex-1">
            <div
              ref={rootRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label={ui.formulas.editor.title}
              aria-multiline="false"
              spellCheck={false}
              onInput={onInput}
              onKeyDown={onKeyDown}
              onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData('text/plain');
                onInsertText(text.replace(/[\r\n]+/g, ' '));
              }}
              className="min-h-6 w-full font-mono text-xs leading-6 break-words whitespace-pre-wrap outline-none"
            />
            {/* Подсказка — В КОНТРОЛЕ, не под ним (канон форм: текст под полем
                ломает горизонталь «метка — поле»). */}
            {empty ? (
              <span className="pointer-events-none absolute inset-0 font-mono text-xs leading-6 text-muted-foreground/70">
                {ui.formulas.editor.placeholder}
              </span>
            ) : null}
            {autocomplete.open ? (
              <div className="absolute top-full left-0 z-30 mt-1 w-72 rounded-xl bg-popover p-1 ring-1 ring-foreground/10">
                <p className="px-2 py-1 text-label-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {ui.formulas.editor.autocomplete}
                </p>
                {autocomplete.items.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onApplyAutocomplete(entry);
                    }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Статус: результат слева, лимиты справа (моно-данные, тихо);
          ошибка — плашкой вместо результата. */}
      <div className="mt-1.5 flex min-h-6 min-w-0 items-start gap-3 px-1">
        {error ? (
          <div className="flex min-w-0 items-start gap-2 rounded-lg bg-danger/10 px-2 py-1 text-xs text-danger">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        ) : (
          <p className="flex min-w-0 items-center gap-2 text-xs">
            <span className="shrink-0 text-muted-foreground">{ui.formulas.editor.result}</span>
            <span
              className={cn(
                'min-w-0 truncate font-mono text-label tabular-nums',
                resultEmpty ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {resultText}
            </span>
          </p>
        )}
        <p className="ml-auto shrink-0 text-label-xs text-muted-foreground/80">
          {`${ui.formulas.editor.limitsLabel}: `}
          <span className="font-mono tabular-nums">
            {`${FORMULA_LIMITS.nodes} / ${FORMULA_LIMITS.sources}`}
          </span>
        </p>
      </div>
      {issues.length > 0 ? (
        <p
          className="mt-1 flex min-w-0 items-start gap-1.5 px-1 text-xs text-danger"
          title={issues.map(issueText).join('\n')}
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 break-words">{issueText(issues[0]!)}</span>
        </p>
      ) : null}
    </div>
  );
}
