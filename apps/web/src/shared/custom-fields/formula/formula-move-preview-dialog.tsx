import type { CustomFieldValue } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

import { formatMoney } from '../value-format.js';
import type { FormulaMoveDialogProps } from './formula-move-preview.js';

/** Сколько строк диффа показываем до «и ещё N»: длинный перенос поддерева
 *  не должен превращать подтверждение в простыню — счётчик остатка честно
 *  говорит, сколько записей ещё изменится. */
export const MOVE_PREVIEW_LIMIT = 10;

/** Значение формулы текстом: у записи диффа нет определения атрибута (и
 *  ссылок), поэтому формат — по форме значения, а не по типу поля. */
export function movePreviewValueText(value: CustomFieldValue | null | undefined): string {
  if (value === null || value === undefined) return ui.customFields.value.empty;
  if (Array.isArray(value))
    return value.length > 0 ? value.join(', ') : ui.customFields.value.empty;
  if (typeof value === 'boolean')
    return value ? ui.customFields.value.yes : ui.customFields.value.no;
  if (typeof value === 'object') return formatMoney(value, null);
  const text = String(value).trim();
  return text === '' ? ui.customFields.value.empty : text;
}

/**
 * Окно подтверждения переноса (#632, критерий 1): «было → станет» по
 * формульным значениям, которые пересчитает новое место записи. Показывается
 * ТОЛЬКО при непустом диффе — «ничего не изменится» окна не заслуживает
 * (перенос идёт сразу). Строка — «{запись} · {атрибут}: {было} → {станет}»:
 * запись и атрибут текстом, значения — данными (моно, tabular-nums).
 */
export function FormulaMovePreviewDialog({ changes, onConfirm, onCancel }: FormulaMoveDialogProps) {
  if (changes.length === 0) return null;
  const shown = changes.slice(0, MOVE_PREVIEW_LIMIT);
  const rest = changes.length - shown.length;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{ui.formulas.move.title}</DialogTitle>
          <DialogDescription>{ui.formulas.move.hint}</DialogDescription>
        </DialogHeader>
        <ul
          aria-label={ui.formulas.move.title}
          className="flex max-h-64 flex-col gap-1 overflow-auto rounded-xl bg-muted/60 p-2 dark:bg-background/60"
        >
          {shown.map((entry) => {
            const from = movePreviewValueText(entry.from);
            const to = movePreviewValueText(entry.to);
            const label = `${entry.hostLabel} · ${entry.fieldName}: ${from} → ${to}`;
            return (
              <li
                key={`${entry.hostKind}:${entry.hostId}:${entry.fieldId}`}
                title={label}
                className="flex min-w-0 items-baseline gap-1.5 px-1 py-0.5 text-[13px]"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {entry.hostLabel} · {entry.fieldName}:
                </span>
                <span className="min-w-0 truncate font-mono tabular-nums text-muted-foreground">
                  {from}
                </span>
                <span aria-hidden className="shrink-0 text-muted-foreground/70">
                  →
                </span>
                <span className="min-w-0 truncate font-mono font-medium tabular-nums text-foreground">
                  {to}
                </span>
              </li>
            );
          })}
        </ul>
        {rest > 0 ? (
          <p className="text-xs text-muted-foreground">
            {ui.formulas.move.more} {rest}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {ui.formulas.move.cancel}
          </Button>
          <Button onClick={onConfirm}>{ui.formulas.move.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
