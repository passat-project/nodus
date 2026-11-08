import { useState } from 'react';
import { Calculator } from 'lucide-react';
import type { NumberSeriesRule } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { TypeFormulaDialog } from '../../../../shared/custom-fields/formula/type-formula-dialog.js';
import { counterPreviewOf } from '../../lib/counter-rule.js';
import { CounterRuleDialog } from './counter-rule-dialog.js';

/**
 * Единое правило counter-атрибута (#630): в основном окне — ОДНА строка
 * «Правило номера» (пример + сводка разреза и периода), полный конструктор
 * открывается кнопкой-калькулятором. Обычных формул мест у счётчика нет —
 * значение выдаёт серия по кнопке процесса; формульный редактор нужен только
 * для произвольного разреза и заменяет окно правила.
 */
export function CounterRuleSection({
  rule,
  name,
  disabled,
  issuedCount,
  onChange,
}: {
  rule: NumberSeriesRule;
  /** Имя атрибута — подзаголовок конструктора. */
  name?: string;
  disabled: boolean;
  /** Выдано номеров серией (редактирование; null — создание). */
  issuedCount: number | null;
  onChange: (rule: NumberSeriesRule) => void;
}) {
  const [editor, setEditor] = useState<'rule' | 'scope' | null>(null);
  const [draft, setDraft] = useState(rule);
  const definitions = useCustomFieldDefinitions('task');
  const taskDefinitions = definitions.data ?? [];
  const counter = ui.customFields.dialog.counter;
  const preview = counterPreviewOf(rule);
  const summary = `${counter.scopeShort[rule.scopeKind]}, ${counter.periodShort[rule.period]}`;

  function openRule() {
    setDraft(rule);
    setEditor('rule');
  }

  return (
    <section className="flex flex-col gap-2">
      <NodeLabel label={counter.title} />
      {/* Строка-сводка: подпись · пример номера · сводка правила · калькулятор.
          Один контрол-кнопка: поля-рамки здесь нет — это вход в настройку. */}
      <button
        type="button"
        disabled={disabled}
        aria-label={counter.edit}
        onClick={openRule}
        className="group flex min-w-0 items-center gap-3 rounded-lg border border-input bg-background py-2 pr-2 pl-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 disabled:opacity-50"
      >
        <span className="shrink-0 text-label text-muted-foreground">{counter.rule}</span>
        <span className="min-w-0 max-w-[50%] shrink truncate font-mono text-sm font-medium tabular-nums">
          {preview === '' ? '—' : preview}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">· {summary}</span>
        <span
          aria-hidden="true"
          className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"
        >
          <Calculator className="size-4" strokeWidth={1.75} />
        </span>
      </button>

      {editor === 'rule' ? (
        <CounterRuleDialog
          rule={draft}
          name={name}
          disabled={disabled}
          issuedCount={issuedCount}
          taskDefinitions={taskDefinitions}
          onChange={setDraft}
          onEditScopeFormula={() => setEditor('scope')}
          onSave={() => {
            onChange(draft);
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {editor === 'scope' ? (
        <TypeFormulaDialog
          open
          hostKind="task"
          targetType="text"
          label={counter.scopeFormula}
          ownDefinitions={taskDefinitions}
          initial={draft.scopeFormula ?? null}
          onSave={(scopeFormula) => {
            setDraft((current) => ({ ...current, scopeFormula }));
            setEditor('rule');
          }}
          onClose={() => setEditor('rule')}
        />
      ) : null}
    </section>
  );
}
