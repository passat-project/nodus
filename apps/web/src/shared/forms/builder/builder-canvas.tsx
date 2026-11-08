import { Fragment, useRef } from 'react';
import { formRows, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { BuilderElement, type ElementActions } from './builder-element.js';
import type { FormBuilderHost } from './builder-host.js';
import { InsertPoint } from './builder-insert.js';
import {
  availableOf,
  decorCount,
  fieldCount,
  insertItem,
  isBuilderField,
  itemId,
  moveItem,
  newDecor,
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
  onChange,
}: {
  value: BuilderValue<X>;
  host: FormBuilderHost<X>;
  readOnly: boolean;
  onChange: (next: BuilderValue<X>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const items = value.items;
  const setItems = (next: typeof items) => onChange({ ...value, items: next });
  const { drag, begin } = usePointerDrag(containerRef, (from, before) =>
    setItems(moveItem(items, from, before)),
  );

  const actions: ElementActions<X> = {
    patchField: (key, patch) => setItems(patchField(items, key, patch)),
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
  const insertAt = (index: number) => (
    <InsertPoint
      available={available}
      fieldsFull={fieldsFull}
      decorFull={decorFull}
      readOnly={readOnly}
      onField={(key) => setItems(insertItem(items, index, host.makeField(key)))}
      onDecor={(kind) => setItems(insertItem(items, index, newDecor(kind)))}
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
