import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FORMULA_FUNCTIONS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';

/** Правая панель редактора формул (§4c): операторы, функции каталога и
 *  агрегаты. Функция вставляется как «ИМЯ(» — аргументы человек пишет в
 *  строке; агрегат открывает диалог выбора выборки/атрибута/условия. */

const OPERATOR_BUTTONS: { symbol: string; insert: string }[] = [
  { symbol: '+', insert: ' + ' },
  { symbol: '−', insert: ' - ' },
  { symbol: '×', insert: ' * ' },
  { symbol: '÷', insert: ' / ' },
  { symbol: '&', insert: ' & ' },
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
    <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex flex-wrap gap-1 border-b border-border/70 px-2 py-2">
        {OPERATOR_BUTTONS.map((operator) => (
          <Button
            key={operator.symbol}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 font-mono text-xs"
            onClick={() => onInsertText(operator.insert)}
          >
            {operator.symbol}
          </Button>
        ))}
      </div>
      <div className="px-2 pt-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ui.formulas.editor.searchFunctions}
          className="h-8 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {FUNCTION_GROUPS.map((group) => {
          const items = filtered.filter((spec) => spec.group === group.key);
          if (items.length === 0) return null;
          return (
            <section key={group.key} className="mb-2">
              <p className="px-1 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1">
                {items.map((spec) => (
                  <Button
                    key={spec.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 font-mono text-[11px]"
                    title={`${ui.formulas.functions[spec.id]}(${
                      spec.minArgs === spec.maxArgs
                        ? spec.minArgs
                        : `${spec.minArgs}–${spec.maxArgs}`
                    })`}
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
          <p className="px-1 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {ui.formulas.functionGroups.aggregate}
          </p>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={onOpenAggregate}
            >
              <Plus className="size-3" strokeWidth={2} />
              {ui.formulas.aggregateDialog.title}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
