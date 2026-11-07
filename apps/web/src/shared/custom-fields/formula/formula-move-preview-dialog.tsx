import type { CustomFieldValue } from '@nodus/contracts';
import { isDashOnlyMarker, ui } from '@nodus/contracts';
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

/**
 * Строки окна, которых ещё нет в i18n: `ui.formulas.move` живёт в контрактах
 * (`packages/contracts/src/i18n/ru-formulas.ts`), а пакет M правит только веб
 * (I15 — перенести в `formulas.move` следующим пакетом #632, здесь — дословно).
 */
const localText = {
  /** Пачка: сводка собрана не по всем записям (потолок или ошибка dry-run). */
  shownOf: (shown: number, total: number) => `Показаны изменения по ${shown} из ${total} записей`,
  /** A9-3: дифф моделирует ПРЯМЫЕ значения; второй порядок сервер считает
   *  после записи — окно не должно обещать полноту. */
  directOnly:
    'Показаны прямые изменения. Формулы, которые берут эти значения как источник, пересчитаются после переноса',
} as const;

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
  // Легаси-дефис в хранимом «было» — то же пусто, не кривой дефис (#632).
  if (text === '' || isDashOnlyMarker(text)) return ui.customFields.value.empty;
  return text;
}

/**
 * Окно подтверждения переноса (#632, критерий 1): «было → станет» по
 * формульным значениям, которые пересчитает новое место записи. Показывается
 * ТОЛЬКО при непустом диффе — «ничего не изменится» окна не заслуживает
 * (перенос идёт сразу).
 *
 * Строка — карточка в две строки: сверху атрибут-плашка и запись, снизу
 * «Было»/«Станет» значениями. Значения НЕ обрезаются (`break-words`): шифр
 * комплекта длиннее колонки, и `truncate` в одну строку превращал дифф в
 * «2026-42-… → 2026-42-…» — по такому окну нельзя решить, переносить ли.
 *
 * Пачка (мультиселект, A9-1/A9-2) приходит сюда же: тот же список «было →
 * станет» по записям всех переносимых хостов, плюс счёт «по скольким записям
 * собрана сводка» — если превью спрошено не у всех, окно это говорит.
 */
export function FormulaMovePreviewDialog({
  changes,
  truncated = false,
  previewed,
  total,
  onConfirm,
  onCancel,
}: FormulaMoveDialogProps) {
  if (changes.length === 0) return null;
  const shown = changes.slice(0, MOVE_PREVIEW_LIMIT);
  const rest = changes.length - shown.length;
  const partial = previewed !== undefined && total !== undefined && previewed < total;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{ui.formulas.move.title}</DialogTitle>
          <DialogDescription>{ui.formulas.move.hint}</DialogDescription>
        </DialogHeader>
        <ul
          aria-label={ui.formulas.move.title}
          className="flex max-h-[min(60vh,26rem)] flex-col gap-1.5 overflow-auto rounded-xl bg-muted/40 p-2"
        >
          {shown.map((entry) => {
            const from = movePreviewValueText(entry.from);
            const to = movePreviewValueText(entry.to);
            return (
              <li
                key={`${entry.hostKind}:${entry.hostId}:${entry.fieldId}`}
                className="flex flex-col gap-1 rounded-lg bg-background/70 px-2.5 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[13px] font-medium text-foreground">
                    {entry.fieldName}
                  </span>
                  <span className="min-w-0 text-[13px] break-words text-muted-foreground">
                    {entry.hostLabel}
                  </span>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs text-muted-foreground">{ui.formulas.move.before}</span>
                  <span className="min-w-0 font-mono text-xs tabular-nums break-words text-muted-foreground">
                    {from}
                  </span>
                  <span className="text-xs text-muted-foreground">{ui.formulas.move.after}</span>
                  <span className="min-w-0 font-mono text-xs font-medium tabular-nums break-words text-foreground">
                    {to}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {/* Оговорки под списком — одной стопкой: остаток строк, обрезка
            выборки, охват сводки пачки и граница модели диффа (A9-3). */}
        <div className="flex flex-col gap-1">
          {rest > 0 ? (
            <p className="text-xs text-muted-foreground">
              {ui.formulas.move.more} {rest}
            </p>
          ) : null}
          {truncated ? (
            <p className="text-xs text-muted-foreground">{ui.formulas.move.truncated}</p>
          ) : null}
          {partial ? (
            <p className="text-xs text-muted-foreground">
              {localText.shownOf(previewed ?? 0, total ?? 0)}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{localText.directOnly}</p>
        </div>
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
