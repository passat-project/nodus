import { useState } from 'react';
import type { FormDecorKind } from '@nodus/contracts';
import { FORM_DECOR_KINDS, ui } from '@nodus/contracts';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';
import { AlignLeft, Heading, Plus, Space } from 'lucide-react';

import type { BuilderBlockOption, BuilderOption } from './builder-host.js';
import { fieldGroups } from './builder-host.js';

const b = ui.forms.builder;

const DECOR_ICONS = { heading: Heading, note: AlignLeft, gap: Space } as const;

/**
 * «+» между строками окна (#496, Р2): поле, которого ещё нет в окне, или
 * оформление — встаёт ровно сюда. Видно при наведении на промежуток и с
 * клавиатуры (фокус); в «только просмотр» — просто промежуток.
 */
export function InsertPoint({
  available,
  blocks = [],
  fieldsFull,
  decorFull,
  decorAllowed = true,
  readOnly,
  onField,
  onBlock,
  onDecor,
}: {
  available: readonly BuilderOption[];
  blocks?: readonly BuilderBlockOption[];
  fieldsFull: boolean;
  decorFull: boolean;
  decorAllowed?: boolean;
  readOnly: boolean;
  onField: (key: string) => void;
  onBlock?: (block: string) => void;
  onDecor: (kind: FormDecorKind) => void;
}) {
  const [open, setOpen] = useState(false);
  if (readOnly) return <div aria-hidden className="h-3" />;
  return (
    <div className="group/insert relative h-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={b.insert}
            title={b.insert}
            className={cn(
              'absolute top-1/2 left-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-popover text-muted-foreground ring-1 ring-border transition-opacity hover:text-foreground focus-visible:opacity-100',
              open ? 'opacity-100' : 'opacity-0 group-hover/insert:opacity-100',
            )}
          >
            <Plus className="size-3" strokeWidth={2} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-64 p-1.5">
          <InsertMenu
            available={available}
            blocks={blocks}
            fieldsFull={fieldsFull}
            decorFull={decorFull}
            decorAllowed={decorAllowed}
            onField={(key) => {
              setOpen(false);
              onField(key);
            }}
            onBlock={(block) => {
              setOpen(false);
              onBlock?.(block);
            }}
            onDecor={(kind) => {
              setOpen(false);
              onDecor(kind);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function InsertMenu({
  available,
  blocks,
  fieldsFull,
  decorFull,
  decorAllowed,
  onField,
  onBlock,
  onDecor,
}: {
  available: readonly BuilderOption[];
  blocks: readonly BuilderBlockOption[];
  fieldsFull: boolean;
  decorFull: boolean;
  decorAllowed: boolean;
  onField: (key: string) => void;
  onBlock: (block: string) => void;
  onDecor: (kind: FormDecorKind) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {fieldsFull ? (
        <p className="px-2 pb-1 text-xs text-muted-foreground">{b.fieldsLimit}</p>
      ) : (
        <>
          {available.length === 0 ? (
            <>
              <p className="px-2 pt-1 text-label-xs text-muted-foreground">{b.insertFields}</p>
              <p className="px-2 pb-1 text-xs text-muted-foreground">{b.insertEmpty}</p>
            </>
          ) : (
            fieldGroups(available).map((group) => (
              <div key={group.label ?? 'fields'} className="flex flex-col gap-0.5">
                <p className="px-2 pt-1 text-label-xs text-muted-foreground">
                  {group.label ?? b.insertFields}
                </p>
                <div className="flex max-h-56 flex-col overflow-y-auto">
                  {group.options.map((option) => (
                    <MenuButton key={option.key} onClick={() => onField(option.key)}>
                      <span className="truncate">{option.label}</span>
                    </MenuButton>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
      {blocks.length > 0 ? (
        <>
          <p className="px-2 pt-1 text-label-xs text-muted-foreground">{b.insertBlocks}</p>
          {blocks.map((option) => (
            <MenuButton key={option.block} onClick={() => onBlock(option.block)}>
              <span className="truncate">{option.label}</span>
            </MenuButton>
          ))}
        </>
      ) : null}
      {decorAllowed ? (
        <>
          <p className="px-2 pt-1 text-label-xs text-muted-foreground">{b.insertDecor}</p>
          {decorFull ? (
            <p className="px-2 pb-1 text-xs text-muted-foreground">{b.decorLimit}</p>
          ) : (
            FORM_DECOR_KINDS.map((kind) => {
              const Icon = DECOR_ICONS[kind];
              return (
                <MenuButton key={kind} onClick={() => onDecor(kind)}>
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  {b.decor[kind]}
                </MenuButton>
              );
            })
          )}
        </>
      ) : null}
    </div>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
