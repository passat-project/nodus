import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { CounterpartyRef, LetterAttachedRef } from '@nodus/contracts';
import { LETTER_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';

import { CounterpartyCombobox } from '../../../shared/counterparties/counterparty-combobox.js';
import { CounterpartyQuickCreate } from '../../../shared/counterparties/counterparty-quick-create.js';
import { useCanCreateCounterparties } from '../../../shared/counterparties/use-crm-permissions.js';
import { DateInput } from './registration/date-input.js';

/** Черновик строки «приложенных писем» (#461, Р3): организация — контрагент
 *  справочника (вердикт владельца 05.11.2026: свободного текста нет). */
export interface RefDraft {
  number: string;
  counterparty: CounterpartyRef | null;
  date: string | null;
}

export const draftOf = (ref?: {
  number: string;
  counterparty?: CounterpartyRef | null;
  date?: string | null;
}): RefDraft => ({
  number: ref?.number ?? '',
  counterparty: ref?.counterparty ?? null,
  date: ref?.date ?? null,
});

/**
 * Окно строки «приложенных писем» (#461): №, организация из справочника,
 * дата листа. Одно на регистрацию и правку в карточке — грамматика ввода
 * одна. Организации вне справочника нет: нет нужного контрагента — «+» у
 * поля заводит его тут же (компактное окно, без ухода из строки) и
 * подставляет в поле. Окно заполняется — мимо-клик его не закрывает; отмена
 * кнопкой или Esc, Enter в номере — сохранить.
 */
export function AttachedRefDialog({
  draft,
  editing,
  onCancel,
  onCommit,
}: {
  draft: RefDraft;
  /** Правка существующей строки (заголовок «Изменить …»). */
  editing: boolean;
  onCancel: () => void;
  onCommit: (draft: RefDraft) => void;
}) {
  const [value, setValue] = useState(draft);
  const [creating, setCreating] = useState(false);
  const canCreate = useCanCreateCounterparties();
  const filled = value.number.trim().length > 0 && value.counterparty !== null;
  const commit = () => {
    if (!filled) return;
    onCommit(value);
  };
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onCancel()}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          // Вложенное окно создания контрагента: Esc гасит только его, строку
          // приложенного не закрываем (Radix ловит Esc на document).
          onEscapeKeyDown={(event) => {
            if (creating) event.preventDefault();
          }}
          className="grid-cols-[minmax(0,1fr)] rounded-[14px] p-5 sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? ui.letters.attached.editTitle : ui.letters.attached.addTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {ui.letters.attached.number}
              </span>
              <Input
                autoFocus
                value={value.number}
                maxLength={LETTER_LIMITS.attachedNumber}
                placeholder={ui.letters.attached.numberPlaceholder}
                onChange={(event) => setValue({ ...value, number: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commit();
                  }
                }}
                className="h-8 font-mono text-sm"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {ui.letters.attached.date}
              </span>
              <DateInput
                value={value.date}
                onChange={(date) => setValue({ ...value, date })}
                ariaLabel={ui.letters.attached.date}
                placeholder={ui.letters.form.datePlaceholder}
                invalid={false}
              />
            </label>
            <div className="col-span-2 flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {ui.letters.attached.organization}
              </span>
              <div className="flex min-w-0 items-center gap-1.5">
                <CounterpartyCombobox
                  value={value.counterparty}
                  onChange={(counterparty) => setValue({ ...value, counterparty })}
                  ariaLabel={ui.letters.attached.organization}
                  placeholder={ui.letters.form.counterpartyPlaceholder}
                />
                {/* Нет нужного контрагента — заводим тут же (право crm.create):
                    справочник остаётся единственным источником организаций. */}
                {canCreate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label={ui.letters.attached.createCounterparty}
                    title={ui.letters.attached.createCounterparty}
                    onClick={() => setCreating(true)}
                  >
                    <Plus className="size-4" strokeWidth={1.75} />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel}>
              {ui.common.cancel}
            </Button>
            <Button disabled={!filled} onClick={commit}>
              {ui.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CounterpartyQuickCreate
        open={creating}
        onOpenChange={setCreating}
        onCreated={(ref) => setValue((current) => ({ ...current, counterparty: ref }))}
      />
    </>
  );
}

/** Строка реестра в отображении: организация — всегда контрагент. */
export const orgNameOf = (ref: LetterAttachedRef): string => ref.counterparty.name;
