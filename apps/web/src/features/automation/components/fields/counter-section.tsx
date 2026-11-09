import type { ReactNode } from 'react';
import type { CustomFieldDefinition, NumberHostKind, NumberSeriesRule } from '@nodus/contracts';
import { numberPeriodsAllowed, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { CircleAlert, Lock } from 'lucide-react';

import {
  SEGMENTED_ACTIVE_TONAL,
  SegmentedControl,
} from '../../../../shared/ui/segmented-control.js';
import {
  counterSequence,
  fill,
  minskMoment,
  withTemplate,
  type ContainerNames,
} from '../../lib/counter-rule.js';
import { CounterContainerPick } from './counter-container-pick.js';
import {
  CounterInsertPalette,
  CounterNumberLine,
  type SegmentFieldGroup,
} from './counter-template-editor.js';

const counter = ui.customFields.dialog.counter;

function NumberInput({
  label,
  hint,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={1}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value === '') onChange(null);
          else if (Number.isFinite(next) && next >= 1) onChange(Math.trunc(next));
        }}
        className="h-8 w-32 text-sm tabular-nums"
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

/**
 * Тело окна «Правило номера» (#630): сводка-предложение, «Кто получает
 * номер» (первый шаг), «Вести счёт отдельно для» (только варианты,
 * подходящие отмеченным типам), «Как выглядит номер», «Начинать счёт
 * заново» (только если в номере есть дата) и старт.
 */
export function CounterSection({
  rule,
  next,
  summary,
  creating,
  issuedCount,
  savedTemplate,
  definitions,
  nodeKinds,
  names,
  hostKinds,
  fields,
  fieldGroups,
  recipients,
  coverage,
  disabled,
  onChange,
  onNextChange,
}: {
  rule: NumberSeriesRule;
  /** «Следующий номер» общего счёта при создании. */
  next: number | null;
  summary: string;
  creating: boolean;
  issuedCount: number;
  /** Вид номера на сервере — предупреждение «новые будут такими». */
  savedTemplate: NumberSeriesRule['template'] | null;
  definitions: readonly CustomFieldDefinition[];
  nodeKinds: readonly { id: string; name: string }[];
  names: ContainerNames;
  /** Виды записей из «Кто получает номер» — фильтр «Вести счёт отдельно для». */
  hostKinds: readonly NumberHostKind[];
  fields: readonly { number: number; name: string }[];
  /** Палитра «Поле…» вида номера по источникам (запись, проект, папка, компания). */
  fieldGroups: readonly SegmentFieldGroup[];
  /** «Кто получает номер» — первый шаг окна, до выбора счёта. */
  recipients: ReactNode;
  /** Охват правила на реальных данных — сразу под «Вести счёт отдельно для». */
  coverage?: ReactNode;
  disabled: boolean;
  onChange: (rule: NumberSeriesRule) => void;
  onNextChange: (next: number | null) => void;
}) {
  const locked = issuedCount > 0;
  const allowed = numberPeriodsAllowed(rule.template);
  const counterSegment = rule.template.find((segment) => segment.kind === 'counter');
  const needsCounter = counterSegment === undefined;
  const company = rule.containers.length === 0;
  const sequence = needsCounter ? [] : counterSequence(rule, company && creating ? next : null);
  const templateChanged =
    locked &&
    savedTemplate !== null &&
    JSON.stringify(savedTemplate) !== JSON.stringify(rule.template);
  const year = minskMoment().year;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <NodeLabel label={counter.title} />
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground dark:bg-background/60">
          {summary}
        </p>
        {locked ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>{fill(counter.lockedBanner, { count: String(issuedCount) })}</span>
          </p>
        ) : null}
      </div>

      {recipients}

      <CounterContainerPick
        containers={rule.containers}
        hostKinds={hostKinds}
        nodeKinds={nodeKinds}
        fields={fields}
        names={names}
        disabled={disabled || locked}
        onChange={(containers) => onChange({ ...rule, containers })}
      />
      {coverage}

      <div className="flex flex-col gap-2">
        <span className="text-label text-muted-foreground">{counter.template}</span>
        <CounterNumberLine
          template={rule.template}
          definitions={definitions}
          names={names}
          disabled={disabled}
          onChange={(template) => onChange(withTemplate(rule, template))}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CounterInsertPalette
            template={rule.template}
            fieldGroups={fieldGroups}
            disabled={disabled}
            onChange={(template) => onChange(withTemplate(rule, template))}
          />
          {counterSegment?.kind === 'counter' ? (
            <label className="flex items-center gap-2" title={counter.segCounterLengthHint}>
              <span className="text-xs text-muted-foreground">{counter.segCounterLength}</span>
              <Input
                type="number"
                min={0}
                max={10}
                value={counterSegment.minLength ?? ''}
                placeholder={counter.segCounterLengthAuto}
                disabled={disabled}
                aria-label={counter.segCounterLength}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value) || value < 0 || value > 10) return;
                  onChange({
                    ...rule,
                    template: rule.template.map((entry) =>
                      entry.kind === 'counter'
                        ? {
                            kind: 'counter',
                            ...(value > 0 ? { minLength: Math.trunc(value) } : {}),
                          }
                        : entry,
                    ),
                  });
                }}
                className="h-7 w-20 min-w-0 text-sm"
              />
            </label>
          ) : null}
        </div>
        {needsCounter ? (
          <p className="flex items-center gap-1.5 text-xs text-danger">
            <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
            {counter.templateNeedsCounter}
          </p>
        ) : (
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{counter.sequence}:</span>
            {sequence.map((item, index) => (
              <span key={index} className="flex items-baseline gap-2">
                {item.boundary ? (
                  <span>→ {item.boundary}:</span>
                ) : index > 0 ? (
                  <span>·</span>
                ) : null}
                <span className="font-mono text-sm font-medium text-foreground tabular-nums">
                  {item.display}
                </span>
              </span>
            ))}
            <span>…</span>
          </p>
        )}
        {templateChanged && !needsCounter ? (
          <p className="text-xs text-warning">
            {fill(counter.templateChanged, { example: sequence[0]?.display ?? '' })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-label text-muted-foreground">{counter.period}</span>
        {allowed.length > 1 ? (
          <SegmentedControl
            value={rule.period}
            disabled={disabled || locked}
            ariaLabel={counter.period}
            activeClassName={SEGMENTED_ACTIVE_TONAL}
            options={allowed.map((period) => ({ value: period, label: counter.periods[period] }))}
            onChange={(period) => onChange({ ...rule, period })}
          />
        ) : (
          <span className="text-xs text-muted-foreground">{counter.periodNeedsDate}</span>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {company && creating ? (
          <NumberInput
            label={
              rule.period === 'none'
                ? counter.next
                : fill(counter.nextInPeriod, { period: `${year}` })
            }
            hint={counter.nextHint}
            value={next}
            placeholder={String(rule.startValue)}
            disabled={disabled}
            onChange={onNextChange}
          />
        ) : null}
        {!company || rule.period !== 'none' ? (
          <NumberInput
            label={counter.start}
            hint={counter.startHint}
            value={rule.startValue}
            disabled={disabled}
            onChange={(startValue) => onChange({ ...rule, startValue: startValue ?? 1 })}
          />
        ) : null}
        <NumberInput
          label={counter.step}
          hint={counter.stepHint}
          value={rule.step}
          disabled={disabled}
          onChange={(step) => onChange({ ...rule, step: Math.min(step ?? 1, 1000) })}
        />
      </div>
    </section>
  );
}
