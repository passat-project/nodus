import { useState } from 'react';
import type { FormDecor, LockEditors } from '@nodus/contracts';
import { FORM_LAYOUT_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';
import {
  Columns2,
  GripVertical,
  Lock,
  RectangleHorizontal,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { FormFieldShell } from '../form-grid.js';
import { BuilderFieldSettings } from './builder-field-settings.js';
import type { FormBuilderHost } from './builder-host.js';
import {
  itemId,
  lockOf,
  type BuilderField,
  type BuilderItem,
  type FieldPatch,
} from './builder-model.js';
import { PreviewControl } from './preview-control.js';

const b = ui.forms.builder;
const l = ui.forms.locks;

export interface ElementActions<X> {
  patchField: (key: string, patch: FieldPatch<X>) => void;
  patchDecor: (id: string, text: string) => void;
  remove: (id: string) => void;
  setLock: (key: string, editors: LockEditors | null) => void;
  beginDrag: (event: React.PointerEvent<HTMLElement>, index: number) => void;
  moveBy: (index: number, delta: -1 | 1) => void;
}

/**
 * Элемент окна в редакторе (#496): поле в превью (как у сотрудника) или
 * оформление, правимое на месте. Ручка слева (тянуть или Alt+↑/↓), справа у
 * подписи — ширина и настройки; клик по контролу тоже открывает настройки.
 */
export function BuilderElement<X>({
  item,
  index,
  paired,
  dragging,
  host,
  locks,
  readOnly,
  actions,
}: {
  item: BuilderItem<X>;
  index: number;
  paired: boolean;
  dragging: boolean;
  host: FormBuilderHost<X>;
  locks: readonly { key: string; editors: LockEditors }[];
  readOnly: boolean;
  actions: ElementActions<X>;
}) {
  return (
    <div
      data-builder-index={index}
      data-builder-paired={paired}
      className={cn(
        'group/item relative min-w-0 rounded-lg px-2 py-1.5 transition-colors',
        !readOnly && 'hover:bg-muted/50 focus-within:bg-muted/50',
        dragging && 'opacity-40',
      )}
    >
      {readOnly ? null : (
        <button
          type="button"
          aria-label={b.dragHandle}
          title={b.dragHint}
          className="absolute top-1.5 -left-6 flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing"
          onPointerDown={(event) => actions.beginDrag(event, index)}
          onKeyDown={(event) => {
            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            event.preventDefault();
            actions.moveBy(index, event.key === 'ArrowUp' ? -1 : 1);
          }}
        >
          <GripVertical className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
      {item.kind === 'field' ? (
        <FieldPreview
          field={item}
          host={host}
          lock={lockOf(locks, item.key)}
          readOnly={readOnly}
          actions={actions}
        />
      ) : (
        <DecorEditor decor={item} readOnly={readOnly} actions={actions} />
      )}
    </div>
  );
}

function FieldPreview<X>({
  field,
  host,
  lock,
  readOnly,
  actions,
}: {
  field: BuilderField<X>;
  host: FormBuilderHost<X>;
  lock: LockEditors | null;
  readOnly: boolean;
  actions: ElementActions<X>;
}) {
  const [open, setOpen] = useState(false);
  const info = host.info(field.key);
  const half = field.width === 'half';
  const badges = [...(info.fromGate ? [b.fromGate] : []), ...(host.badges?.(field) ?? [])];
  const lockText = lock === 'none' ? l.editorsNone : lock === 'owners' ? l.editorsOwners : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="min-w-0">
          <FormFieldShell
            label={info.unknown ? b.unknownField : (field.label ?? info.label)}
            required={host.required?.(field) ?? false}
            hint={field.hint}
            notice={
              <span className="flex items-center gap-1">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="text-label-xs whitespace-nowrap text-muted-foreground"
                    title={badge === b.fromGate ? b.fromGateHint : undefined}
                  >
                    {badge}
                  </span>
                ))}
                {lockText ? (
                  <span className="flex text-primary" title={lockText}>
                    <Lock className="size-3" strokeWidth={2} aria-hidden />
                    <span className="sr-only">{lockText}</span>
                  </span>
                ) : null}
                {readOnly || info.unknown || info.noLayout ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
                    aria-label={half ? b.widthFull : b.widthHalf}
                    title={half ? b.widthFull : b.widthHalf}
                    onClick={() => actions.patchField(field.key, { width: half ? 'full' : 'half' })}
                  >
                    {half ? (
                      <RectangleHorizontal className="size-3.5" strokeWidth={1.75} />
                    ) : (
                      <Columns2 className="size-3.5" strokeWidth={1.75} />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    'text-muted-foreground',
                    !open && 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100',
                  )}
                  aria-label={b.settings}
                  title={b.settings}
                  onClick={() => setOpen(true)}
                >
                  <SlidersHorizontal className="size-3.5" strokeWidth={1.75} />
                </Button>
              </span>
            }
          >
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className={cn('block w-full text-left', info.unknown && 'opacity-50')}
              onClick={() => setOpen(true)}
            >
              <PreviewControl
                kind={info.preview}
                height={info.multiline ? field.height : undefined}
              />
            </button>
          </FormFieldShell>
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-80">
        <BuilderFieldSettings
          field={field}
          info={info}
          host={host}
          lock={lock}
          readOnly={readOnly}
          onPatch={(patch) => actions.patchField(field.key, patch)}
          onLock={(editors) => actions.setLock(field.key, editors)}
          onRemove={() => {
            setOpen(false);
            actions.remove(itemId(field));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DecorEditor<X>({
  decor,
  readOnly,
  actions,
}: {
  decor: FormDecor;
  readOnly: boolean;
  actions: ElementActions<X>;
}) {
  const [focused, setFocused] = useState(false);
  const empty = decor.kind !== 'gap' && decor.text.trim().length === 0;
  return (
    <div className="flex min-w-0 items-start gap-1">
      <div className="min-w-0 flex-1">
        {decor.kind === 'gap' ? (
          <div className="flex h-6 items-center justify-center rounded-md bg-muted/60 text-label-xs text-muted-foreground">
            {b.decor.gap}
          </div>
        ) : decor.kind === 'heading' ? (
          <input
            value={decor.text}
            maxLength={FORM_LAYOUT_LIMITS.heading}
            readOnly={readOnly}
            placeholder={b.headingPlaceholder}
            aria-label={b.decor.heading}
            className="w-full min-w-0 bg-transparent pt-1 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => actions.patchDecor(decor.id, event.target.value)}
          />
        ) : (
          <textarea
            value={decor.text}
            maxLength={FORM_LAYOUT_LIMITS.note}
            readOnly={readOnly}
            rows={1}
            placeholder={b.notePlaceholder}
            aria-label={b.decor.note}
            className="field-sizing-content block min-h-5 w-full min-w-0 resize-none bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/70"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => actions.patchDecor(decor.id, event.target.value)}
          />
        )}
        {empty && !focused ? <p className="pt-0.5 text-xs text-danger">{b.decorEmpty}</p> : null}
      </div>
      {readOnly ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          aria-label={`${b.remove}: ${b.decor[decor.kind]}`}
          title={b.remove}
          onClick={() => actions.remove(decor.id)}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </Button>
      )}
    </div>
  );
}
