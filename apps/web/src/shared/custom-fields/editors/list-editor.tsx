import { Check, Search } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useDictionaryItems } from '../../dictionaries/queries.js';
import { CustomFieldValueView, refsById } from '../value-view.js';
import { EditorTrigger, type EditorProps } from './editor-kit.js';

/**
 * Список и «Список (несколько)»: варианты — элементы справочника (I15),
 * выбираются по id, подписи обновляются вместе со справочником. Один —
 * закрывается после выбора, несколько — остаётся открытым (модель
 * Битрикс24); выбранные отмечены галочкой. Высота зоны списка фиксирована:
 * поиск и фильтрация не меняют габарит поповера (канон оверлеев).
 */
export function ListEditor(props: EditorProps) {
  const multiple = props.definition.type === 'multienum';
  const code = props.definition.dictionary?.code ?? null;
  const { data: items = [] } = useDictionaryItems(code);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = new Set<string>(
    multiple
      ? Array.isArray(props.value)
        ? props.value
        : []
      : typeof props.value === 'string'
        ? [props.value]
        : [],
  );
  const q = query.trim().toLowerCase();
  const visible = q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;

  function toggle(id: string) {
    if (multiple) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const ids = [...next];
      props.onCommit(ids.length > 0 ? ids : null, refsFor(ids));
      return;
    }
    props.onCommit(id, refsFor([id]));
    setOpen(false);
  }

  function refsFor(ids: readonly string[]) {
    return items
      .filter((item) => ids.includes(item.id))
      .map((item) => ({
        kind: 'dictionary_item' as const,
        id: item.id,
        name: item.name,
        avatarUrl: null,
        archived: !item.isActive,
      }));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <EditorTrigger
          variant={props.variant}
          disabled={props.disabled}
          ariaLabel={props.definition.name}
          open={open}
          // Правка по месту — без обрезки значения: длинное имя варианта
          // («ОВ — Отопление, вентиляция и кондиционирование воздуха»)
          // переносится строкой ниже, а не уезжает под край узкой панели.
          multiline={props.variant === 'inline' && !multiple}
        >
          <CustomFieldValueView
            definition={props.definition}
            value={props.value}
            refs={refsById(props.refs)}
            wrap={props.variant === 'inline' && !multiple}
          />
        </EditorTrigger>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        {items.length > 5 ? (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ui.common.searchPlaceholder}
              aria-label={ui.common.search}
              className="h-8 pl-8 text-sm"
              autoFocus
            />
          </div>
        ) : null}
        {/* Высота зоны списка — от ПОЛНОГО набора (не от фильтра): поиск и
            пустой результат не меняют габарит поповера (канон оверлеев). */}
        <div
          className="overflow-y-auto"
          style={{ height: Math.min(Math.max(items.length, 1), 8) * 32 + 8 }}
          data-no-scrollbar
        >
          {visible.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {ui.filters.notFound}
            </p>
          ) : (
            visible.map((item) => {
              const on = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent/60',
                    on ? 'text-port' : 'text-secondary-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {on ? <Check className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
