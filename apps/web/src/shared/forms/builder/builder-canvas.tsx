import { Fragment, useRef } from 'react';
import { formRows, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { BuilderElement, type ElementActions } from './builder-element.js';
import type { FormBuilderHost } from './builder-host.js';
import { InsertPoint } from './builder-insert.js';
import {
  availableOf,
  blocksStart,
  clampInsert,
  decorCount,
  fieldCount,
  insertItem,
  isBuilderBlock,
  isBuilderField,
  itemId,
  moveItem,
  newDecor,
  patchBlock,
  patchDecorText,
  patchField,
  removeItem,
  setLock,
  type BuilderValue,
} from './builder-model.js';
import { usePointerDrag } from './use-pointer-drag.js';

const b = ui.forms.builder;

/**
 * Холст редактора окна (#496, Р2): строки окна как у сотрудника (две
 * половины рядом, уже 30rem — одна колонка), «+» в каждом промежутке, свой
 * pointer-drag с линией места вставки. Убранное поле снимает и свой замок
 * («Закрепить также» вернёт его, если нужно).
 */
export function BuilderCanvas<X>({
  value,
  host,
  readOnly,
  focusKey,
  onChange,
}: {
  value: BuilderValue<X>;
  host: FormBuilderHost<X>;
  readOnly: boolean;
  focusKey?: string | null;
  onChange: (next: BuilderValue<X>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const items = value.items;
  const setItems = (next: typeof items) => onChange({ ...value, items: next });
  const { drag, begin } = usePointerDrag(containerRef, (from, before) =>
    setItems(moveItem(items, from, clampInsert(items, from, before))),
  );

  const actions: ElementActions<X> = {
    patchField: (key, patch) => setItems(patchField(items, key, patch)),
    patchBlock: (block, patch) => setItems(patchBlock(items, block, patch)),
    patchDecor: (id, text) => setItems(patchDecorText(items, id, text)),
    remove: (id) => {
      const removed = items.find((item) => itemId(item) === id);
      onChange({
        items: removeItem(items, id),
        locks:
          removed && isBuilderField(removed)
            ? value.locks.filter((lock) => lock.key !== removed.key)
            : value.locks,
      });
    },
    setLock: (key, editors) => onChange({ ...value, locks: setLock(value.locks, key, editors) }),
    beginDrag: begin,
    moveBy: (index, delta) => setItems(moveItem(items, index, delta < 0 ? index - 1 : index + 2)),
  };

  const fieldsFull = fieldCount(items) >= host.limits.fields;
  const decorFull = decorCount(items) >= host.limits.decor;
  const available = availableOf(host.catalog, items);
  const availableBlocks = (host.blocks ?? []).filter(
    (option) => !items.some((item) => isBuilderBlock(item) && item.block === option.block),
  );
  const boundary = blocksStart(items);
  const insertAt = (index: number) => (
    <InsertPoint
      available={index <= boundary ? available : []}
      blocks={index >= boundary ? availableBlocks : []}
      fieldsFull={fieldsFull}
      decorFull={decorFull}
      decorAllowed={index <= boundary}
      readOnly={readOnly}
      onField={(key) => setItems(insertItem(items, Math.min(index, boundary), host.makeField(key)))}
      onBlock={(block) => {
        if (!host.makeBlock) return;
        setItems(insertItem(items, Math.max(index, boundary), host.makeBlock(block)));
      }}
      onDecor={(kind) => setItems(insertItem(items, Math.min(index, boundary), newDecor(kind)))}
    />
  );

  const indexed = items.map((item, index) => ({ item, index }));
  const rows = formRows(indexed, ({ item }) => isBuilderField(item) && item.width === 'half');

  return (
    <div ref={containerRef} className="relative min-w-0 @container">
      {items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{b.emptyWindow}</p>
      ) : null}
      {insertAt(0)}
      {rows.map((row) => (
        <Fragment key={itemId(row[0]!.item)}>
          <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-3 @min-[30rem]:grid-cols-2">
            {row.map(({ item, index }) => (
              <div
                key={itemId(item)}
                className={cn(
                  'min-w-0',
                  row.length === 1 &&
                    !(isBuilderField(item) && item.width === 'half') &&
                    '@min-[30rem]:col-span-2',
                )}
              >
                <BuilderElement
                  item={item}
                  index={index}
                  paired={row.length === 2}
                  dragging={drag?.from === index}
                  host={host}
                  locks={value.locks}
                  readOnly={readOnly}
                  focusKey={focusKey}
                  actions={actions}
                />
              </div>
            ))}
          </div>
          {insertAt(row[row.length - 1]!.index + 1)}
        </Fragment>
      ))}
      {drag?.indicator ? (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-full bg-primary"
          style={drag.indicator}
        />
      ) : null}
    </div>
  );
}
