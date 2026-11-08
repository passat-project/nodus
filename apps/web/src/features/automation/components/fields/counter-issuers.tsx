import type { NumberHostKind, NumberIssuer, NumberSeriesRule } from '@nodus/contracts';
import { numberHostHasButtons, ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { CircleAlert } from 'lucide-react';

import { createTriggerReason, fill } from '../../lib/counter-rule.js';

const counter = ui.customFields.dialog.counter;

/**
 * Способ выдачи номера — выпадающий список прямо в строке отмеченного типа
 * «Кто получает номер» (#630, замечание владельца 08.11: отдельный список
 * типов ради одного чекбокса — дублирование). Варианты: «При создании» (и
 * при смене типа на этот) или «Кнопкой процесса» — кнопки добавляют в
 * редакторе процесса, здесь видно какие; позже — правилом (#448/#634) и
 * строкой реестра (#636). У папок и проектов кнопок нет — только «При
 * создании», без списка (одна опция — шум). Письму «При создании» нельзя,
 * если счёт зависит от места или полей письма — причина в подсказке.
 */
export function CounterTriggerSelect({
  targetId,
  host,
  rule,
  onCreate,
  issuers,
  disabled,
  onChange,
}: {
  targetId: string;
  host: NumberHostKind;
  rule: NumberSeriesRule;
  onCreate: readonly string[];
  issuers: readonly NumberIssuer[];
  disabled: boolean;
  onChange: (onCreate: string[]) => void;
}) {
  const create = onCreate.includes(targetId);
  if (!numberHostHasButtons(host)) {
    return (
      <span className="shrink-0 px-2 text-xs text-muted-foreground">
        {counter.triggerOptions.create}
      </span>
    );
  }
  const buttons = issuers.filter((issuer) => issuer.processTypeId === targetId);
  const buttonLabel =
    buttons.length > 0
      ? fill(counter.triggerButtonNamed, {
          buttons: buttons.map((issuer) => `«${issuer.transitionName}»`).join(', '),
        })
      : counter.triggerButtonMissing;
  const blocked = createTriggerReason(rule, host);
  return (
    <Select
      value={create ? 'create' : 'button'}
      disabled={disabled}
      onValueChange={(value) =>
        onChange(
          value === 'create'
            ? [...new Set([...onCreate, targetId])]
            : onCreate.filter((id) => id !== targetId),
        )
      }
    >
      <SelectTrigger
        className="h-7 w-auto max-w-[15rem] shrink-0 gap-1 px-2 text-xs"
        aria-label={counter.triggerPick}
        title={blocked ?? counter.triggerCreateHint}
      >
        <SelectValue>{create ? counter.triggerOptions.create : buttonLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="nokey">
        <SelectItem value="create" disabled={blocked !== null && !create}>
          {counter.triggerOptions.create}
        </SelectItem>
        <SelectItem value="button">{buttonLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Подсказки под «Кто получает номер»: где добавляют кнопку и правило
 *  «кто первым заполнил — тот выдал»; поломанный способ — строкой ошибки. */
export function CounterTriggerHints({ broken }: { broken: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{counter.triggerButtonHint}</span>
      {broken ? (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          {counter.triggerNeedsCreate}
        </p>
      ) : (
        <span className="text-xs text-muted-foreground">{counter.issuersFirstWins}</span>
      )}
    </div>
  );
}
