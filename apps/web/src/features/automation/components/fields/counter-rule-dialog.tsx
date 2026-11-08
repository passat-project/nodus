import { useRef, useState } from 'react';
import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  NumberHostKind,
  NumberIssuer,
  NumberSeriesRule,
} from '@nodus/contracts';
import {
  numberContainerReachable,
  numberHostHasButtons,
  numberSeriesRuleSchema,
  ui,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';

import type { ContainerNames } from '../../lib/counter-rule.js';
import { CounterCheck } from './counter-check.js';
import { CounterIssuers } from './counter-issuers.js';
import { containerKindsFor } from './counter-container-pick.js';
import { CounterCounts } from './counter-counts.js';
import { CounterSection } from './counter-section.js';
import { FieldUsagePicker, type DescribeTarget } from './field-usage-picker.js';

const counter = ui.customFields.dialog.counter;

/** Справочники и вычисления окна, собранные панелью (одни запросы). */
export interface CounterRuleKit {
  names: ContainerNames;
  definitions: readonly CustomFieldDefinition[];
  nodeKinds: readonly { id: string; name: string }[];
  summaryOf: (rule: NumberSeriesRule, next: number | null, bindings: CustomFieldBindings) => string;
  describeTargetFor: (rule: NumberSeriesRule) => DescribeTarget;
  hostKindsOf: (bindings: CustomFieldBindings) => NumberHostKind[];
  fieldsFor: (bindings: CustomFieldBindings) => { number: number; name: string }[];
  /** Кнопки опубликованных маршрутов, выдающие номер (только чтение). */
  issuers: readonly NumberIssuer[];
  typeName: (typeId: string) => string | undefined;
}

/**
 * Окно «Правило номера» (#630, решения владельца 08.11): отдельно от окна
 * атрибута. Сверху вниз: «Кто получает номер» → «Вести счёт отдельно для»
 * (только подходящие отмеченным типам варианты) → вид номера → когда
 * заново → старт → «Проверка на записи» → «Текущие счета». Формул нет.
 */
export function CounterRuleDialog({
  name,
  rule: initialRule,
  next: initialNext,
  bindings: initialBindings,
  definition,
  preview,
  kit,
  disabled,
  onSave,
  onClose,
}: {
  name: string;
  rule: NumberSeriesRule;
  next: number | null;
  bindings: CustomFieldBindings;
  definition: CustomFieldDefinition | null;
  preview: CustomFieldDefinition | null;
  kit: CounterRuleKit;
  disabled: boolean;
  onSave: (rule: NumberSeriesRule, next: number | null, bindings: CustomFieldBindings) => void;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [rule, setRule] = useState(initialRule);
  const [next, setNext] = useState(initialNext);
  const [bindings, setBindings] = useState(initialBindings);
  const hostKinds = kit.hostKindsOf(bindings);
  const locked = (definition?.numbering?.issuedCount ?? 0) > 0;
  const needsCreate = hostKinds.some((host) => !numberHostHasButtons(host)) && !rule.issueOnCreate;
  const valid =
    numberSeriesRuleSchema.safeParse(rule).success &&
    !needsCreate &&
    hostKinds.every((host) => numberContainerReachable(rule.container, host));
  const participantTypeIds = [
    ...bindings.processTypeIds,
    ...bindings.projectTypeIds,
    ...bindings.nodeKindIds,
  ];

  function changeBindings(nextBindings: CustomFieldBindings) {
    setBindings(nextBindings);
    // Отметили тип, которому выбранный счёт не подходит (письмо при папке),
    // — счёт сбрасывается на общий, пока номера не выдавались.
    const kinds = kit.hostKindsOf(nextBindings);
    let nextRule = rule;
    if (!locked && !containerKindsFor(kinds).includes(rule.container.kind)) {
      nextRule = { ...nextRule, container: { kind: 'company' } };
    }
    // У папок нет кнопок процесса: отметили папку — включаем «при создании».
    if (kinds.some((host) => !numberHostHasButtons(host)) && !nextRule.issueOnCreate) {
      nextRule = { ...nextRule, issueOnCreate: true };
    }
    if (nextRule !== rule) setRule(nextRule);
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        className="flex max-h-[min(90vh,52rem)] flex-col gap-4 overflow-hidden outline-none sm:max-w-[44rem]"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
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
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
          <CounterSection
            rule={rule}
            next={next}
            summary={kit.summaryOf(rule, next, bindings)}
            creating={definition === null}
            issuedCount={definition?.numbering?.issuedCount ?? 0}
            savedTemplate={definition?.numbering?.rule.template ?? null}
            definitions={kit.definitions}
            nodeKinds={kit.nodeKinds}
            names={kit.names}
            hostKinds={hostKinds}
            fields={kit.fieldsFor(bindings)}
            disabled={disabled}
            onChange={setRule}
            onNextChange={setNext}
            recipients={
              <section className="flex flex-col gap-2">
                <NodeLabel label={counter.recipients} />
                <FieldUsagePicker
                  definition={preview}
                  bindings={bindings}
                  bindingFormulas={{}}
                  onBindingFormulasChange={() => undefined}
                  disabled={disabled}
                  allowFormulas={false}
                  describeTarget={kit.describeTargetFor(rule)}
                  hint={counter.recipientsHint}
                  onChange={changeBindings}
                />
                <CounterIssuers
                  rule={rule}
                  issuers={kit.issuers}
                  typeName={kit.typeName}
                  needsCreate={needsCreate}
                  disabled={disabled}
                  onChange={(issueOnCreate) => setRule({ ...rule, issueOnCreate })}
                />
              </section>
            }
          />
          {hostKinds.length > 0 && valid ? (
            <CounterCheck
              rule={rule}
              definitionId={definition?.id ?? null}
              participantTypeIds={participantTypeIds}
              kinds={hostKinds}
              names={kit.names}
            />
          ) : null}
          {definition ? <CounterCounts definitionId={definition.id} disabled={disabled} /> : null}
        </div>
        <DialogFooter className="items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {ui.formulas.editor.cancel}
          </Button>
          <Button
            type="button"
            disabled={disabled || !valid}
            onClick={() => {
              onSave(rule, next, bindings);
              onClose();
            }}
          >
            {counter.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
