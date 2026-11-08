import type { NumberHostKind, NumberIssuer, NumberSeriesRule } from '@nodus/contracts';
import { numberHostHasButtons, ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { CircleAlert, MousePointerClick } from 'lucide-react';

import { createTriggerReason, fill } from '../../lib/counter-rule.js';

const counter = ui.customFields.dialog.counter;

/** Тип из «Кто получает номер». */
export interface CounterTarget {
  id: string;
  name: string;
  host: NumberHostKind;
}

/**
 * «Когда выдаётся» (#630, модель v3 — вердикт владельца 08.11: «проекты во
 * время создания, письмо во время регистрации, задача во время выдачи»): у
 * КАЖДОГО типа свой способ. «При создании» отмечается здесь (у создания нет
 * своего редактора) и срабатывает и при смене типа на этот; кнопки маршрутов
 * с действием «Присвоить номер» настраиваются в редакторе процесса — здесь
 * только список. Позже — правила/шаги (#448/#634) и строки реестров (#636).
 * Кто первым заполнил поле — тот выдал; остальные номер не меняют.
 */
export function CounterIssuers({
  targets,
  rule,
  onCreate,
  issuers,
  disabled,
  onChange,
}: {
  targets: readonly CounterTarget[];
  rule: NumberSeriesRule;
  onCreate: readonly string[];
  issuers: readonly NumberIssuer[];
  disabled: boolean;
  onChange: (onCreate: string[]) => void;
}) {
  if (targets.length === 0) return null;
  const chosen = new Set(onCreate);
  const buttonsOf = (target: CounterTarget) =>
    issuers.filter((issuer) => issuer.processTypeId === target.id);
  const silent = targets.filter(
    (target) => !chosen.has(target.id) && buttonsOf(target).length === 0,
  );
  const needsCreate = silent.some((target) => !numberHostHasButtons(target.host));

  function toggle(target: CounterTarget, checked: boolean) {
    onChange(checked ? [...onCreate, target.id] : onCreate.filter((id) => id !== target.id));
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <span className="text-label text-muted-foreground">{counter.triggers}</span>
      <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-input">
        {targets.map((target) => {
          const buttons = buttonsOf(target);
          const problem = chosen.has(target.id) ? createTriggerReason(rule, target.host) : null;
          const blocked = createTriggerReason(rule, target.host);
          return (
            <li key={target.id} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">«{target.name}»</span>
                <label
                  className="flex items-center gap-2 text-sm"
                  title={blocked ?? counter.triggerCreateHint}
                >
                  <Checkbox
                    checked={chosen.has(target.id)}
                    disabled={disabled || (blocked !== null && !chosen.has(target.id))}
                    aria-label={`${counter.triggerCreate} — ${target.name}`}
                    onCheckedChange={(checked) => toggle(target, checked === true)}
                  />
                  {counter.triggerCreate}
                </label>
              </div>
              {buttons.length > 0 ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MousePointerClick className="size-3.5 shrink-0" strokeWidth={1.75} />
                  {fill(counter.triggerButtons, {
                    buttons: buttons.map((issuer) => `«${issuer.transitionName}»`).join(', '),
                  })}
                </span>
              ) : !chosen.has(target.id) ? (
                <span
                  className={
                    numberHostHasButtons(target.host)
                      ? 'text-xs text-warning'
                      : 'text-xs text-danger'
                  }
                >
                  {numberHostHasButtons(target.host)
                    ? counter.triggerNone
                    : counter.triggerNeedsCreate}
                </span>
              ) : null}
              {problem ? (
                <span className="flex items-center gap-1.5 text-xs text-danger">
                  <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
                  {problem}
                </span>
              ) : blocked && !chosen.has(target.id) ? (
                <span className="text-xs text-muted-foreground">{blocked}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <span className="text-xs text-muted-foreground">{counter.triggerButtonHint}</span>
      {needsCreate || silent.length === targets.length ? (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          {needsCreate ? counter.triggerNeedsCreate : counter.issuersNone}
        </p>
      ) : (
        <span className="text-xs text-muted-foreground">{counter.issuersFirstWins}</span>
      )}
    </div>
  );
}
