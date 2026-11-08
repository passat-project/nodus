import { useState } from 'react';
import { checkFormDecor, hasPairedRow, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { cn } from '@nodus/ui/lib/utils';

import { BuilderCanvas } from './builder-canvas.js';
import type { FormBuilderHost } from './builder-host.js';
import { isBuilderField, type BuilderValue } from './builder-model.js';
import { BuilderAlsoLocks, BuilderTray } from './builder-side.js';

const b = ui.forms.builder;

/**
 * Редактор окна ввода поверх экрана (#496, В8): окно в натуральную величину
 * — так его увидит сотрудник — с ручками, «+» между строками, лотком полей и
 * «Закрепить также». Черновик живёт здесь до «Готово» — одним шагом в
 * документ хоста; «Отмена» — без следа. С правками Esc окно не закрывает:
 * случайная клавиша не стирает работу. Без права — только просмотр.
 * `blockEmptyDecor` — хост сохраняет сразу (папка, проект): пустой
 * заголовок/пояснение не уйдёт на сервер; у маршрута его ловит публикация.
 */
export function FormBuilder<X>({
  open,
  host,
  value,
  readOnly,
  blockEmptyDecor = false,
  onCancel,
  onDone,
}: {
  open: boolean;
  host: FormBuilderHost<X>;
  value: BuilderValue<X>;
  readOnly: boolean;
  blockEmptyDecor?: boolean;
  onCancel: () => void;
  onDone: (next: BuilderValue<X>) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [openedFor, setOpenedFor] = useState(open);
  if (openedFor !== open) {
    setOpenedFor(open);
    if (open) setDraft(value);
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const emptyDecor = checkFormDecor(draft.items).length > 0;
  const wide = hasPairedRow(draft.items, (item) => isBuilderField(item) && item.width === 'half');

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent
        overlay={false}
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (dirty) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">{host.title}</DialogTitle>
        <header className="flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{host.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {readOnly ? b.readOnly : dirty ? b.unsaved : b.lead}
            </p>
          </div>
          {readOnly ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {b.close}
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onCancel}>
                {b.cancel}
              </Button>
              <Button
                type="button"
                disabled={!dirty || (blockEmptyDecor && emptyDecor)}
                title={blockEmptyDecor && emptyDecor ? b.decorEmpty : undefined}
                onClick={() => onDone(draft)}
              >
                {b.done}
              </Button>
            </>
          )}
        </header>
        <div className="min-h-0 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-4 py-6">
            <div
              className={cn(
                'mx-auto flex w-full min-w-0 flex-col gap-3 rounded-xl bg-popover py-5 pr-6 pl-8 text-popover-foreground ring-1 ring-foreground/10',
                wide ? 'max-w-2xl' : 'max-w-lg',
              )}
            >
              {host.fixedTop}
              <BuilderCanvas value={draft} host={host} readOnly={readOnly} onChange={setDraft} />
              {host.footer}
            </div>
            {readOnly ? null : <BuilderTray value={draft} host={host} onChange={setDraft} />}
            {host.lockMode ? (
              <BuilderAlsoLocks value={draft} host={host} readOnly={readOnly} onChange={setDraft} />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
