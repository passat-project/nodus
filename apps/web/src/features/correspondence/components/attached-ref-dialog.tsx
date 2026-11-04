import { useState } from 'react';
import type { LetterAttachedRef } from '@nodus/contracts';
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
import { DateInput } from './registration/date-input.js';

/** Черновик строки «приложенных писем» (#461, Р3): организация — контрагент
 *  справочника ИЛИ текст с листа (у бумажного письма контрагента может не
 *  быть в справочнике). */
export interface RefDraft {
  number: string;
  counterparty: LetterAttachedRef['counterparty'];
  orgText: string;
  date: string | null;
}

export const draftOf = (ref?: {
  number: string;
  counterparty?: LetterAttachedRef['counterparty'];
  orgText?: string | null;
  date?: string | null;
}): RefDraft => ({
  number: ref?.number ?? '',
  counterparty: ref?.counterparty ?? null,
  orgText: ref?.orgText ?? '',
  date: ref?.date ?? null,
});

/**
 * Окно строки «приложенных писем» (#461): №, организация (контрагент или
 * текст с листа), дата листа. Одно на регистрацию и правку в карточке —
 * грамматика ввода одна.
 */
export function AttachedRefDialog({
  draft,
  onCancel,
  onCommit,
}: {
  draft: RefDraft;
  onCancel: () => void;
  onCommit: (draft: RefDraft) => void;
}) {
  const [value, setValue] = useState(draft);
  const [byText, setByText] = useState(draft.counterparty === null);
  const filled =
    value.number.trim().length > 0 &&
    (byText ? value.orgText.trim().length > 0 : Boolean(value.counterparty));
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md rounded-[14px] p-5">
        <DialogHeader>
          <DialogTitle>{ui.letters.attached.add}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {ui.letters.attached.number}
            </span>
            <Input
              autoFocus
              value={value.number}
              maxLength={LETTER_LIMITS.attachedNumber}
              placeholder={ui.letters.attached.numberPlaceholder}
              onChange={(event) => setValue({ ...value, number: event.target.value })}
              className="h-8 font-mono text-sm"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {ui.letters.attached.organization}
            </span>
            {byText ? (
              <Input
                value={value.orgText}
                maxLength={LETTER_LIMITS.attachedOrg}
                placeholder={ui.letters.attached.orgPlaceholder}
                onChange={(event) => setValue({ ...value, orgText: event.target.value })}
                className="h-8 text-sm"
              />
            ) : (
              <CounterpartyCombobox
                value={value.counterparty}
                onChange={(counterparty) => setValue({ ...value, counterparty })}
                ariaLabel={ui.letters.attached.organization}
                placeholder={ui.letters.form.counterpartyPlaceholder}
              />
            )}
            <button
              type="button"
              onClick={() => {
                setByText((current) => !current);
                setValue({ ...value, counterparty: null, orgText: '' });
              }}
              className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {byText
                ? ui.letters.form.counterpartyPlaceholder
                : ui.letters.attached.orgPlaceholder}
            </button>
          </div>
          <label className="flex flex-col gap-1">
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!filled} onClick={() => onCommit(value)}>
            {ui.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
