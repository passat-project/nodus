import { Search } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useCounterpartyOptions } from '../../counterparties/queries.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { CustomFieldValueView, refsById } from '../value-view.js';
import { EditorTrigger, type EditorProps } from './editor-kit.js';

/**
 * Контрагент: выбор из живого справочника CRM (порт работает и при
 * выключенном флаге модуля, Р11). Создания «на лету» здесь нет — значение
 * поля ссылается на существующую запись; архивные не выбираются.
 */
export function CounterpartyEditor(props: EditorProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), 250);
  const { data: options = [] } = useCounterpartyOptions(query);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <PopoverTrigger asChild>
        <EditorTrigger
          variant={props.variant}
          disabled={props.disabled}
          ariaLabel={props.definition.name}
          open={open}
        >
          <CustomFieldValueView
            definition={props.definition}
            value={props.value}
            refs={refsById(props.refs)}
          />
        </EditorTrigger>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={ui.counterparties.searchPlaceholder}
            aria-label={ui.common.search}
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
        <div className="h-64 overflow-y-auto" data-no-scrollbar>
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {ui.counterparties.empty}
            </p>
          ) : (
            options.map((counterparty) => {
              const on = props.value === counterparty.id;
              return (
                <button
                  key={counterparty.id}
                  type="button"
                  onClick={() => {
                    props.onCommit(counterparty.id, [
                      {
                        kind: 'counterparty',
                        id: counterparty.id,
                        name: counterparty.shortName,
                        avatarUrl: null,
                        archived: counterparty.archivedAt !== null,
                      },
                    ]);
                    setOpen(false);
                    // Программное закрытие минует onOpenChange — строку поиска
                    // чистим здесь (канон поповеров-пикеров).
                    setText('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent/60',
                    on ? 'text-port' : 'text-secondary-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{counterparty.shortName}</span>
                  {counterparty.unp ? (
                    <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                      {counterparty.unp}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
