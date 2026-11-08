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
  focusKey,
  onCancel,
  onDone,
}: {
  open: boolean;
  host: FormBuilderHost<X>;
  value: BuilderValue<X>;
  readOnly: boolean;
  blockEmptyDecor?: boolean;
  /** Ключ поля, чьи настройки открыть сразу (переход из проблемы публикации). */
  focusKey?: string | null;
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
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          'max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0',
          wide ? 'max-w-3xl sm:max-w-3xl' : 'max-w-2xl sm:max-w-2xl',
        )}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (dirty) event.preventDefault();
        }}
      >
        <div className="flex min-w-0 flex-col gap-0.5 px-5 pt-4 pb-3">
          <DialogTitle className="truncate text-base font-medium">{host.title}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {readOnly ? b.readOnly : dirty ? b.unsaved : b.lead}
          </p>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-2">
          <div className="flex w-full min-w-0 flex-col gap-4">
            <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl bg-background py-4 pr-4 pl-8 ring-1 ring-foreground/10">
              {host.fixedTop}
              <BuilderCanvas
                value={draft}
                host={host}
                readOnly={readOnly}
                focusKey={focusKey}
                onChange={setDraft}
              />
              {host.footer}
            </div>
            {readOnly ? null : <BuilderTray value={draft} host={host} onChange={setDraft} />}
            {host.lockMode ? (
              <BuilderAlsoLocks value={draft} host={host} readOnly={readOnly} onChange={setDraft} />
            ) : null}
          </div>
        </div>
        <div className="flex h-12 shrink-0 items-center justify-end gap-2 px-5">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
