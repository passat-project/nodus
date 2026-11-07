import { useState } from 'react';
import type { NumberSeriesRule } from '@nodus/contracts';
import { formulaToText, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { TypeFormulaDialog } from '../../../../shared/custom-fields/formula/type-formula-dialog.js';
import { COUNTER_SCOPE_PRESETS, counterPreviewOf } from '../../lib/counter-rule.js';
import { CounterTemplateEditor } from './counter-template-editor.js';

/**
 * Секция «Счётчик» окна атрибута (#630, Р6/§4c): правило серии — разрез
 * (заготовки + своя формула), период, вид номера (конструктор —
 * counter-template-editor), старт и живой предпросмотр со счётом выданных.
 * Механика; визуальный канон доводит ui-writer (Пакет 1b).
 */
export function CounterRuleSection({
  rule,
  disabled,
  issuedCount,
  onChange,
}: {
  rule: NumberSeriesRule;
  disabled: boolean;
  /** Выдано номеров серией (редактирование; null — создание). */
  issuedCount: number | null;
  onChange: (rule: NumberSeriesRule) => void;
}) {
  const [formulaOpen, setFormulaOpen] = useState(false);
  // Атрибуты задач: адреса плашек «Поле…» и подписи формулы разреза.
  const definitions = useCustomFieldDefinitions('task');
  const taskDefinitions = definitions.data ?? [];
  const labelOf = (fieldNumber: number) =>
    taskDefinitions.find((entry) => entry.number === fieldNumber)?.name ?? `№${fieldNumber}`;

  const needsFormula = rule.scopeKind === 'formula' && rule.scopeFormula == null;

  function patchRule(patch: Partial<NumberSeriesRule>) {
    onChange({ ...rule, ...patch });
  }

  return (
    <section className="flex flex-col gap-3">
      <NodeLabel label={ui.customFields.dialog.counter.title} />
      <p className="text-xs text-muted-foreground">{ui.customFields.dialog.counter.hint}</p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-muted-foreground">
            {ui.customFields.dialog.counter.scope}
          </span>
          <Select
            value={rule.scopeKind}
            disabled={disabled}
            onValueChange={(scopeKind) =>
              patchRule({
                scopeKind: scopeKind as NumberSeriesRule['scopeKind'],
                scopeFormula: scopeKind === 'formula' ? rule.scopeFormula : null,
              })
            }
          >
            <SelectTrigger className="h-8 w-full" aria-label={ui.customFields.dialog.counter.scope}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              {COUNTER_SCOPE_PRESETS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {ui.customFields.dialog.counter.scopeKinds[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-muted-foreground">
            {ui.customFields.dialog.counter.start}
          </span>
          <Input
            type="number"
            min={1}
            value={rule.startValue}
            disabled={disabled}
            aria-label={ui.customFields.dialog.counter.start}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && next >= 1) patchRule({ startValue: Math.trunc(next) });
            }}
            className="h-8 text-sm"
          />
          <span className="text-label-xs text-muted-foreground">
            {ui.customFields.dialog.counter.startHint}
          </span>
        </label>
      </div>

      {rule.scopeKind === 'formula' ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setFormulaOpen(true)}
            className="flex h-8 min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 text-left text-sm hover:bg-accent/40 disabled:opacity-50"
          >
            <span className="min-w-0 truncate">
              {rule.scopeFormula
                ? formulaToText(rule.scopeFormula, labelOf)
                : ui.customFields.dialog.counter.scopeFormulaRequired}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {ui.formulas.typeFormula.edit}
            </span>
          </button>
          {needsFormula ? (
            <p className="text-xs text-danger">
              {ui.customFields.dialog.counter.scopeFormulaRequired}
            </p>
          ) : null}
          {formulaOpen ? (
            <TypeFormulaDialog
              open={formulaOpen}
              hostKind="task"
              targetType="text"
              label={ui.customFields.dialog.counter.scopeFormula}
              ownDefinitions={taskDefinitions}
              initial={rule.scopeFormula ?? null}
              onSave={(ast) => {
                patchRule({ scopeFormula: ast });
                setFormulaOpen(false);
              }}
              onClose={() => setFormulaOpen(false)}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-label text-muted-foreground">
          {ui.customFields.dialog.counter.period}
        </span>
        <div className="flex flex-wrap gap-1">
          {(['none', 'year', 'month'] as const).map((period) => (
            <button
              key={period}
              type="button"
              disabled={disabled}
              aria-pressed={rule.period === period}
              onClick={() => patchRule({ period })}
              className={cn(
                'h-8 rounded-lg border px-3 text-sm transition-colors',
                rule.period === period
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:bg-accent/40',
              )}
            >
              {ui.customFields.dialog.counter.periods[period]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-label text-muted-foreground">
          {ui.customFields.dialog.counter.template}
        </span>
        <CounterTemplateEditor
          template={rule.template}
          taskDefinitions={taskDefinitions}
          disabled={disabled}
          onChange={(template) => patchRule({ template })}
        />
      </div>

      <div className="flex items-baseline gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2">
        <span className="text-label text-muted-foreground">
          {ui.customFields.dialog.counter.preview}
        </span>
        <span className="min-w-0 truncate font-mono text-sm">{counterPreviewOf(rule)}</span>
        {issuedCount !== null && issuedCount > 0 ? (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {ui.customFields.dialog.counter.issuedCount}: {issuedCount}
          </span>
        ) : null}
      </div>
    </section>
  );
}
