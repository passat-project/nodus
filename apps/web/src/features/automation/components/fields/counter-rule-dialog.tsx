import { useRef, useState } from 'react';
import type { CustomFieldDefinition, NumberHostKind, NumberSeriesRule } from '@nodus/contracts';
import { numberSeriesRuleSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

import type { ContainerNames } from '../../lib/counter-rule.js';
import { CounterCheck } from './counter-check.js';
import { CounterCounts } from './counter-counts.js';
import { CounterSection } from './counter-section.js';

const counter = ui.customFields.dialog.counter;

/**
 * Окно правила счётчика (#630): всё, что определяет номер, — отдельно от
 * окна атрибута (решение владельца 08.11: основное окно не загромождаем).
 * Правило одно на атрибут: «Как выглядит номер», «Свой счёт внутри»,
 * «Начинать счёт заново», старт, «Проверка на записи» по черновику и
 * «Текущие счета» (живые, правятся сразу). Формул здесь нет.
 */
export function CounterRuleDialog({
  name,
  rule: initialRule,
  next: initialNext,
  summaryOf,
  definition,
  participantTypeIds,
  kinds,
  definitions,
  nodeKinds,
  names,
  disabled,
  onSave,
  onClose,
}: {
  name: string;
  rule: NumberSeriesRule;
  next: number | null;
  summaryOf: (rule: NumberSeriesRule, next: number | null) => string;
  definition: CustomFieldDefinition | null;
  participantTypeIds: readonly string[];
  kinds: readonly NumberHostKind[];
  definitions: readonly CustomFieldDefinition[];
  nodeKinds: readonly { id: string; name: string }[];
  names: ContainerNames;
  disabled: boolean;
  onSave: (rule: NumberSeriesRule, next: number | null) => void;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [rule, setRule] = useState(initialRule);
  const [next, setNext] = useState(initialNext);
  const valid = numberSeriesRuleSchema.safeParse(rule).success;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        className="flex max-h-[min(90vh,48rem)] flex-col gap-4 overflow-hidden outline-none sm:max-w-[42rem]"
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
            summary={summaryOf(rule, next)}
            creating={definition === null}
            issuedCount={definition?.numbering?.issuedCount ?? 0}
            savedTemplate={definition?.numbering?.rule.template ?? null}
            definitions={definitions}
            nodeKinds={nodeKinds}
            names={names}
            disabled={disabled}
            onChange={setRule}
            onNextChange={setNext}
          />
          {kinds.length > 0 && valid ? (
            <CounterCheck
              rule={rule}
              definitionId={definition?.id ?? null}
              participantTypeIds={participantTypeIds}
              kinds={kinds}
              names={names}
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
              onSave(rule, next);
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
