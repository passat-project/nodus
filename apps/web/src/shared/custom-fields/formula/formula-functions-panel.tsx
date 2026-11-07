import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FORMULA_FUNCTIONS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';

/** Правая панель редактора формул (§4c): операторы, функции каталога и
 *  агрегаты. Функция вставляется как «ИМЯ(» — аргументы человек пишет в
 *  строке; агрегат открывает диалог выбора выборки/атрибута/условия.
 *
 *  Клавиши (операторы и функции) — одна грамматика: тонированная подложка
 *  на ступени панели, hover — `accent`, без «угольков»-обводок (канон панелей).
 *  Операторы — моно-символы, функции — моно-имена (это код, не текст). */

const OPERATOR_BUTTONS: { symbol: string; insert: string }[] = [
  { symbol: '+', insert: ' + ' },
  { symbol: '−', insert: ' - ' },
  { symbol: '×', insert: ' * ' },
  { symbol: '÷', insert: ' / ' },
  { symbol: '=', insert: ' = ' },
  { symbol: '≠', insert: ' <> ' },
  { symbol: '<', insert: ' < ' },
  { symbol: '≤', insert: ' <= ' },
  { symbol: '>', insert: ' > ' },
  { symbol: '≥', insert: ' >= ' },
];

const FUNCTION_GROUPS = [
  { key: 'logic', label: ui.formulas.functionGroups.logic },
  { key: 'math', label: ui.formulas.functionGroups.math },
  { key: 'text', label: ui.formulas.functionGroups.text },
  { key: 'date', label: ui.formulas.functionGroups.date },
] as const;

const GROUP_CLASS =
  'px-1 pt-2.5 pb-1 text-label-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase';

export function FormulaFunctionsPanel({
  onInsertText,
  onOpenAggregate,
}: {
  onInsertText: (text: string) => void;
  onOpenAggregate: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = FORMULA_FUNCTIONS.filter(
    (spec) =>
      query.trim().length === 0 ||
      ui.formulas.functions[spec.id].toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-muted/60 dark:bg-background/60">
      <div className="shrink-0 p-2 pb-0">
        <div className="flex flex-wrap gap-1">
          {OPERATOR_BUTTONS.map((operator) => (
            <Button
              key={operator.symbol}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 bg-popover p-0 font-mono text-xs text-foreground hover:bg-muted dark:bg-input/50 dark:hover:bg-input/70"
              aria-label={operator.insert.trim()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsertText(operator.insert)}
            >
              {operator.symbol}
            </Button>
          ))}
        </div>
      </div>
      <div className="shrink-0 px-2 pt-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ui.formulas.editor.searchFunctions}
          aria-label={ui.formulas.editor.searchFunctions}
          className="h-8 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {FUNCTION_GROUPS.map((group) => {
          const items = filtered.filter((spec) => spec.group === group.key);
          if (items.length === 0) return null;
          return (
            <section key={group.key}>
              <p className={GROUP_CLASS}>{group.label}</p>
              <div className="flex flex-wrap gap-1">
                {items.map((spec) => (
                  <Button
                    key={spec.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 bg-popover px-2 font-mono text-label-sm text-foreground hover:bg-muted dark:bg-input/50 dark:hover:bg-input/70"
                    title={`${ui.formulas.functions[spec.id]}(${
                      spec.minArgs === spec.maxArgs
                        ? spec.minArgs
                        : `${spec.minArgs}–${spec.maxArgs}`
                    })`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onInsertText(`${ui.formulas.functions[spec.id]}(`)}
                  >
                    {ui.formulas.functions[spec.id]}
                  </Button>
                ))}
              </div>
            </section>
          );
        })}
        <section>
          <p className={GROUP_CLASS}>{ui.formulas.functionGroups.aggregate}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 bg-primary/10 px-2 text-label-sm text-primary hover:bg-primary/15 hover:text-primary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onOpenAggregate}
          >
            <Plus className="size-3" strokeWidth={2} />
            {ui.formulas.aggregateDialog.title}
          </Button>
        </section>
      </div>
    </div>
  );
}
