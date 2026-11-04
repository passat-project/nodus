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
import { Segmented } from '../../../shared/ui/panel/panel-kit.js';
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

type OrgMode = 'directory' | 'text';

/**
 * Окно строки «приложенных писем» (#461): №, организация (контрагент
 * справочника или текст с листа — переключатель над полем), дата листа.
 * Одно на регистрацию и правку в карточке — грамматика ввода одна. Окно
 * заполняется — мимо-клик его не закрывает (канон окон с вводом); отмена —
 * кнопкой или Esc, Enter в поле номера — сохранить.
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
  // Новая строка — справочник (контрагенты чаще уже есть); правка текстовой
  // строки — сразу текст.
  const [mode, setMode] = useState<OrgMode>(
    draft.counterparty === null && draft.orgText.length > 0 ? 'text' : 'directory',
  );
  const filled =
    value.number.trim().length > 0 &&
    (mode === 'text' ? value.orgText.trim().length > 0 : Boolean(value.counterparty));
  const commit = () => {
    if (!filled) return;
    onCommit(mode === 'text' ? { ...value, counterparty: null } : { ...value, orgText: '' });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {ui.letters.attached.organization}
              </span>
              <Segmented
                value={mode}
                options={[
                  { value: 'directory', label: ui.letters.attached.fromDirectory },
                  { value: 'text', label: ui.letters.attached.asText },
                ]}
                onChange={setMode}
              />
            </div>
            {mode === 'text' ? (
              <Input
                value={value.orgText}
                maxLength={LETTER_LIMITS.attachedOrg}
                placeholder={ui.letters.attached.orgPlaceholder}
                aria-label={ui.letters.attached.organization}
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
  );
}
