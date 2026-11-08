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
  numberCreateTriggerProblem,
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
import { CounterBackfillButton } from './counter-backfill-dialog.js';
import { CounterCheck } from './counter-check.js';
import { CounterIssuers, type CounterTarget } from './counter-issuers.js';
import { CounterCounts } from './counter-counts.js';
import { CounterCoverage } from './counter-coverage.js';
import { CounterSection } from './counter-section.js';
import type { SegmentFieldGroup } from './counter-template-editor.js';
import { FieldUsagePicker, type DescribeTarget } from './field-usage-picker.js';

export type { SegmentFieldGroup } from './counter-template-editor.js';

const counter = ui.customFields.dialog.counter;

/** Справочники и вычисления окна, собранные панелью (одни запросы). */
export interface CounterRuleKit {
  names: ContainerNames;
  definitions: readonly CustomFieldDefinition[];
  nodeKinds: readonly { id: string; name: string }[];
  nodeKindsFor: (bindings: CustomFieldBindings) => readonly { id: string; name: string }[];
  summaryOf: (rule: NumberSeriesRule, next: number | null, bindings: CustomFieldBindings) => string;
  describeTargetFor: (rule: NumberSeriesRule) => DescribeTarget;
  hostKindsOf: (bindings: CustomFieldBindings) => NumberHostKind[];
  /** Вид записи цели привязки (тип задачи/письма, тип проекта, вид папки). */
  hostKindOf: (targetId: string) => NumberHostKind | null;
  fieldsFor: (bindings: CustomFieldBindings) => { number: number; name: string }[];
  /** Палитра «Поле…» вида номера по источникам. */
  segmentFieldsFor: (bindings: CustomFieldBindings) => SegmentFieldGroup[];
  /** Кнопки опубликованных маршрутов, выдающие номер (только чтение). */
  issuers: readonly NumberIssuer[];
  typeName: (typeId: string) => string | undefined;
}

const idsOf = (bindings: CustomFieldBindings) => [
  ...bindings.processTypeIds,
  ...bindings.projectTypeIds,
  ...bindings.nodeKindIds,
];

/**
 * Окно «Правило номера» (#630, модель v3 — вердикты владельца 08.11):
 * отдельно от окна атрибута. Сверху вниз: «Кто получает номер» и когда (у
 * каждого типа свой способ) → «Вести счёт отдельно для» (до трёх условий,
 * только подходящие отмеченным типам) → охват → вид номера → когда заново →
 * старт и шаг → «Проверка на записи» → «Текущие счета» и «Выдать номера
 * существующим». Формул нет.
 */
export function CounterRuleDialog({
  name,
  rule: initialRule,
  next: initialNext,
  bindings: initialBindings,
  onCreate: initialOnCreate,
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
  onCreate: readonly string[];
  definition: CustomFieldDefinition | null;
  preview: CustomFieldDefinition | null;
  kit: CounterRuleKit;
  disabled: boolean;
  onSave: (
    rule: NumberSeriesRule,
    next: number | null,
    bindings: CustomFieldBindings,
    onCreate: string[],
  ) => void;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [rule, setRule] = useState(initialRule);
  const [next, setNext] = useState(initialNext);
  const [bindings, setBindings] = useState(initialBindings);
  const [onCreate, setOnCreate] = useState<string[]>([...initialOnCreate]);
  const hostKinds = kit.hostKindsOf(bindings);
  const locked = (definition?.numbering?.issuedCount ?? 0) > 0;
  const targets: CounterTarget[] = idsOf(bindings).flatMap((id) => {
    const host = kit.hostKindOf(id);
    return host ? [{ id, name: kit.typeName(id) ?? '—', host }] : [];
  });
  const chosen = targets.filter((target) => onCreate.includes(target.id)).map((t) => t.id);
  // Сохранить нельзя: папке/проекту номер выдать нечем без «при создании»;
  // письму «при создании» со счётом по месту или полями письма.
  const triggerBroken = targets.some((target) =>
    numberHostHasButtons(target.host)
      ? chosen.includes(target.id) && numberCreateTriggerProblem(rule, target.host) !== null
      : !chosen.includes(target.id),
  );
  const valid =
    numberSeriesRuleSchema.safeParse(rule).success &&
    !triggerBroken &&
    hostKinds.every((host) =>
      rule.containers.every((container) => numberContainerReachable(container, host)),
    );
  const participantTypeIds = idsOf(bindings);

  function changeBindings(nextBindings: CustomFieldBindings) {
    setBindings(nextBindings);
    // Отметили тип, которому выбранное условие не подходит (письмо при
    // папке), — условие убирается, пока номера не выдавались.
    const kinds = kit.hostKindsOf(nextBindings);
    if (!locked) {
      const containers = rule.containers.filter((container) =>
        kinds.every((host) => numberContainerReachable(container, host)),
      );
      if (containers.length !== rule.containers.length) setRule({ ...rule, containers });
    }
    // У папок и проектов нет кнопок процесса: новый такой тип сразу
    // получает номер «при создании».
    const before = new Set(idsOf(bindings));
    const added = idsOf(nextBindings).filter((id) => {
      const host = kit.hostKindOf(id);
      return !before.has(id) && host !== null && !numberHostHasButtons(host);
    });
    if (added.length > 0) setOnCreate((current) => [...new Set([...current, ...added])]);
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
            nodeKinds={kit.nodeKindsFor(bindings)}
            names={kit.names}
            hostKinds={hostKinds}
            fields={kit.fieldsFor(bindings)}
            fieldGroups={kit.segmentFieldsFor(bindings)}
            disabled={disabled}
            onChange={setRule}
            onNextChange={setNext}
            coverage={
              <CounterCoverage
                rule={rule}
                participantTypeIds={participantTypeIds}
                names={kit.names}
              />
            }
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
                  targets={targets}
                  rule={rule}
                  onCreate={chosen}
                  issuers={kit.issuers}
                  disabled={disabled}
                  onChange={setOnCreate}
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
          {definition ? (
            <div className="flex flex-col gap-3">
              <CounterCounts definitionId={definition.id} rule={rule} disabled={disabled} />
              <CounterBackfillButton
                definitionId={definition.id}
                count={definition.numbering?.withoutNumber ?? 0}
                disabled={disabled}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter className="items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {ui.formulas.editor.cancel}
          </Button>
          <Button
            type="button"
            disabled={disabled || !valid}
            onClick={() => {
              onSave(rule, next, bindings, chosen);
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
