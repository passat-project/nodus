import type { CustomFieldDefinition, NumberSeriesRule } from '@nodus/contracts';
import { useRef } from 'react';
import { formulaToText, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
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
import { CircleAlert } from 'lucide-react';

import { SegmentedControl } from '../../../../shared/ui/segmented-control.js';
import { COUNTER_SCOPE_PRESETS, counterPreviewOf } from '../../lib/counter-rule.js';
import { CounterInsertPalette, CounterNumberLine } from './counter-template-editor.js';

/**
 * Конструктор правила счётчика (#630, §4c + решение UI-чекпоинта 08.11):
 * два смысловых блока — «вид номера» (строка сегментов, живой пример, палитра
 * вставок) и «счёт» (разрез, период, первый номер). Визуальный язык общий с
 * калькулятором #632: info-баннер, рамка `input` у единственного контрола
 * строки, статус-строка результата, пунктир палитры. Обычных формул значения
 * у счётчика нет — формульный редактор открывается только для произвольного
 * разреза и ЗАМЕНЯЕТ это окно, а не складывается поверх.
 */
export function CounterRuleDialog({
  rule,
  name,
  disabled,
  issuedCount,
  taskDefinitions,
  onChange,
  onEditScopeFormula,
  onSave,
  onClose,
}: {
  rule: NumberSeriesRule;
  /** Имя атрибута в заголовке (как «Формула типа · Название» у #632). */
  name?: string;
  disabled: boolean;
  issuedCount: number | null;
  taskDefinitions: readonly CustomFieldDefinition[];
  onChange: (rule: NumberSeriesRule) => void;
  onEditScopeFormula: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const counter = ui.customFields.dialog.counter;
  const labelOf = (fieldNumber: number) =>
    taskDefinitions.find((entry) => entry.number === fieldNumber)?.name ?? `№${fieldNumber}`;
  const needsFormula = rule.scopeKind === 'formula' && rule.scopeFormula == null;
  const needsCounter = rule.template.filter((segment) => segment.kind === 'counter').length !== 1;
  const counterSegment = rule.template.find((segment) => segment.kind === 'counter');

  function patchRule(patch: Partial<NumberSeriesRule>) {
    onChange({ ...rule, ...patch });
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        className="flex max-h-[min(88vh,44rem)] flex-col gap-4 overflow-hidden outline-none sm:max-w-[40rem]"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        // Автофокус не в первое поле: иначе открытие «Изм.» выделяло литерал
        // префикса синим — выглядело как артефакт, а не как приглашение к правке.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0">{counter.dialogTitle}</span>
            {name ? (
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                {name}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
          <p className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
            {counter.hint}
          </p>

          {/* Вид номера — что человек увидит в поле после кнопки. */}
          <section className="flex flex-col gap-2">
            <NodeLabel label={counter.template} />
            <CounterNumberLine
              template={rule.template}
              taskDefinitions={taskDefinitions}
              disabled={disabled}
              onChange={(template) => patchRule({ template })}
            />
            {needsCounter ? (
              <p className="flex min-w-0 items-start gap-1.5 px-1 text-xs text-danger">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 break-words">{counter.templateNeedsCounter}</span>
              </p>
            ) : (
              // Пример номера — плашка результата: сборка сверху, что из неё
              // выйдет — отдельной полосой, а не подписью под полем. Тон —
              // «углубление» как у палитры калькулятора #632: в тёмной теме
              // `--muted` темнее поповера, поэтому там берётся фон.
              <div className="flex min-h-9 min-w-0 items-center gap-2.5 rounded-lg bg-muted/60 px-3 py-1.5 dark:bg-background/60">
                <span className="shrink-0 text-xs text-muted-foreground">{counter.preview}</span>
                <span className="min-w-0 truncate font-mono text-sm font-medium tabular-nums">
                  {counterPreviewOf(rule)}
                </span>
              </div>
            )}
            <CounterInsertPalette
              template={rule.template}
              taskDefinitions={taskDefinitions}
              disabled={disabled}
              onChange={(template) => patchRule({ template })}
            />
            {counterSegment?.kind === 'counter' ? (
              <label className="flex items-center gap-2">
                <span className="text-label text-muted-foreground">{counter.segCounterLength}</span>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={counterSegment.minLength ?? 0}
                  disabled={disabled}
                  aria-label={counter.segCounterLength}
                  title={counter.segCounterLengthHint}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next >= 0 && next <= 10) {
                      patchRule({
                        template: rule.template.map((entry) =>
                          entry.kind === 'counter'
                            ? { ...entry, minLength: next > 0 ? Math.trunc(next) : undefined }
                            : entry,
                        ),
                      });
                    }
                  }}
                  className="h-7 w-14 min-w-0 text-sm"
                />
              </label>
            ) : null}
          </section>

          {/* Счёт — от чего зависит следующее значение. */}
          <section className="flex flex-col gap-3">
            <NodeLabel label={counter.count} />
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-muted-foreground">{counter.scope}</span>
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
                <SelectTrigger className="h-8 w-full" aria-label={counter.scope}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="nokey">
                  {COUNTER_SCOPE_PRESETS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {counter.scopeKinds[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {rule.scopeKind === 'formula' ? (
              <button
                type="button"
                disabled={disabled}
                onClick={onEditScopeFormula}
                aria-invalid={needsFormula || undefined}
                className={cn(
                  'flex min-h-8 min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-left transition-colors outline-none disabled:opacity-50',
                  'focus-visible:ring-1 focus-visible:ring-ring/30',
                  needsFormula
                    ? 'border-danger/50 bg-danger/5 text-danger'
                    : 'border-input bg-background hover:bg-accent/40',
                )}
              >
                {needsFormula ? (
                  <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
                ) : null}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs',
                    needsFormula ? 'text-danger' : 'font-mono text-foreground',
                  )}
                >
                  {rule.scopeFormula
                    ? formulaToText(rule.scopeFormula, labelOf)
                    : counter.scopeFormulaRequired}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    needsFormula ? 'font-medium text-danger' : 'text-muted-foreground',
                  )}
                >
                  {needsFormula ? ui.formulas.typeFormula.set : ui.formulas.typeFormula.edit}
                </span>
              </button>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <span className="text-label text-muted-foreground">{counter.period}</span>
              <SegmentedControl
                value={rule.period}
                disabled={disabled}
                ariaLabel={counter.period}
                activeClassName="bg-accent text-foreground"
                layout="grid"
                options={(['none', 'year', 'month'] as const).map((period) => ({
                  value: period,
                  label: counter.periods[period],
                }))}
                onChange={(period) => patchRule({ period })}
              />
            </div>

            <div className="flex items-end gap-4">
              <label className="flex w-28 flex-col gap-1.5">
                <span className="text-label text-muted-foreground">{counter.start}</span>
                <Input
                  type="number"
                  min={1}
                  value={rule.startValue}
                  disabled={disabled}
                  aria-label={counter.start}
                  title={counter.startHint}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 1) {
                      patchRule({ startValue: Math.trunc(next) });
                    }
                  }}
                  className="h-8 text-sm"
                />
              </label>
              {issuedCount !== null && issuedCount > 0 ? (
                <p className="pb-2 text-xs text-muted-foreground">
                  {counter.issuedCount}:{' '}
                  <span className="font-mono tabular-nums">{issuedCount}</span>
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <DialogFooter className="items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {ui.formulas.editor.cancel}
          </Button>
          <Button
            type="button"
            disabled={disabled || needsFormula || needsCounter}
            onClick={onSave}
          >
            {ui.customFields.dialog.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
