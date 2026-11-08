import type { NumberIssuer, NumberSeriesRule } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { CircleAlert, MousePointerClick } from 'lucide-react';

import { fill } from '../../lib/counter-rule.js';

const counter = ui.customFields.dialog.counter;

/**
 * «Когда выдаётся номер» (#630, модель 08.11): источников выдачи несколько —
 * момент создания записи (флаг правила: у создания нет своего редактора),
 * кнопки маршрутов с действием «Присвоить номер» (настраиваются в редакторе
 * процесса, здесь — только список), позже правила/шаги автоматизации
 * (#448/#634) и строки реестров (#636). Кто первым заполнил поле — тот
 * выдал; остальные номер не меняют.
 */
export function CounterIssuers({
  rule,
  issuers,
  typeName,
  needsCreate,
  disabled,
  onChange,
}: {
  rule: NumberSeriesRule;
  issuers: readonly NumberIssuer[];
  typeName: (typeId: string) => string | undefined;
  /** Отмечены папки/проекты (кнопок нет), а «при создании» выключено. */
  needsCreate: boolean;
  disabled: boolean;
  onChange: (issueOnCreate: boolean) => void;
}) {
  const nobody = !rule.issueOnCreate && issuers.length === 0;
  return (
    <div className="flex flex-col gap-2 pt-1">
      <span className="text-label text-muted-foreground">{counter.issuers}</span>
      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={rule.issueOnCreate}
          disabled={disabled}
          aria-label={counter.issueOnCreate}
          onCheckedChange={(checked) => onChange(checked === true)}
          className="mt-0.5"
        />
        <span className="flex flex-col">
          <span>{counter.issueOnCreate}</span>
          <span className="text-xs text-muted-foreground">{counter.issueOnCreateHint}</span>
        </span>
      </label>
      {issuers.map((issuer) => (
        <p
          key={`${issuer.processTypeId}|${issuer.transitionId}`}
          className="flex items-center gap-2.5 text-sm"
        >
          <MousePointerClick className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          {fill(counter.issuerButton, {
            button: issuer.transitionName,
            type: typeName(issuer.processTypeId) ?? '—',
          })}
        </p>
      ))}
      <span className="text-xs text-muted-foreground">{counter.issuerButtonHint}</span>
      {needsCreate || nobody ? (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          {needsCreate ? counter.needsCreateForFolders : counter.issuersNone}
        </p>
      ) : (
        <span className="text-xs text-muted-foreground">{counter.issuersFirstWins}</span>
      )}
    </div>
  );
}
