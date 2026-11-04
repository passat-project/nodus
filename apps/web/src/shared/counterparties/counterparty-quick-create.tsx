import { useState } from 'react';
import type { CounterpartyRef } from '@nodus/contracts';
import { normalizeUnp, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';

import { useCreateCounterparty } from './mutations.js';

/**
 * Компактное создание контрагента «не выходя из окна» (#461): у строки
 * «приложенного письма» организация — только справочник, и если нужной
 * компании нет, её заводят здесь же. Три поля (краткое, полное, УНП);
 * полное по умолчанию равно краткому. Возвращает ссылку `{id, name}` и
 * подставляет её в поле — полное окно контрагента (с адресом, контактами и
 * проверкой дублей по УНП) остаётся в CRM.
 */
export function CounterpartyQuickCreate({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ref: CounterpartyRef) => void;
}) {
  const create = useCreateCounterparty();
  const [shortName, setShortName] = useState('');
  const [fullName, setFullName] = useState('');
  const [unp, setUnp] = useState('');
  const valid = shortName.trim().length > 0;
  const reset = () => {
    setShortName('');
    setFullName('');
    setUnp('');
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };
  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate(
      {
        shortName: shortName.trim(),
        fullName: fullName.trim() || shortName.trim(),
        unp: normalizeUnp(unp) || null,
        address: null,
        email: null,
        phone: null,
      },
      {
        onSuccess: (card) => {
          onCreated({ id: card.id, name: card.shortName });
          close();
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        showCloseButton={false}
        // Вложенный лист: без второго задника — родительское окно строки
        // остаётся читаемым за ним.
        overlay={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="grid-cols-[minmax(0,1fr)] rounded-[14px] p-5 sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{ui.letters.attached.createCounterparty}</DialogTitle>
          <DialogDescription>{ui.letters.attached.createCounterpartyHint}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {ui.counterparties.fieldShortName}
            </span>
            <Input
              autoFocus
              value={shortName}
              onChange={(event) => setShortName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={ui.counterparties.shortNamePlaceholder}
              className="h-8 text-sm"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {ui.counterparties.fieldFullName}
            </span>
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder={shortName.trim() || ui.counterparties.fullNamePlaceholder}
              className="h-8 text-sm"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {ui.counterparties.unp}
            </span>
            <Input
              value={unp}
              onChange={(event) => setUnp(event.target.value)}
              placeholder={ui.counterparties.unpHint}
              className="h-8 font-mono text-sm"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!valid || create.isPending} onClick={submit}>
            {ui.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
