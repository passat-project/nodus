import type { LockEditors } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { GripVertical } from 'lucide-react';

import type { FormBuilderHost } from './builder-host.js';
import { BlockPreview, DecorEditor, FieldPreview } from './builder-element-parts.js';
import type { BlockPatch, BuilderItem, FieldPatch } from './builder-model.js';

const b = ui.forms.builder;

export interface ElementActions<X> {
  patchField: (key: string, patch: FieldPatch<X>) => void;
  patchBlock: (block: string, patch: BlockPatch<X>) => void;
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
  focusKey,
  actions,
}: {
  item: BuilderItem<X>;
  index: number;
  paired: boolean;
  dragging: boolean;
  host: FormBuilderHost<X>;
  locks: readonly { key: string; editors: LockEditors }[];
  readOnly: boolean;
  focusKey?: string | null;
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
      {readOnly || (item.kind === 'field' && item.fixed) ? null : (
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
          locks={locks}
          readOnly={readOnly}
          focusKey={focusKey}
          actions={actions}
        />
      ) : item.kind === 'block' ? (
        <BlockPreview block={item} host={host} readOnly={readOnly} actions={actions} />
      ) : (
        <DecorEditor decor={item} readOnly={readOnly} actions={actions} />
      )}
    </div>
  );
}
