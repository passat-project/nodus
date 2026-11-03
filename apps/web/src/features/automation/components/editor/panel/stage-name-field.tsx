import { useEffect, useRef, useState } from 'react';
import type { TaskSystemState, WorkflowStageName } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useActiveOption } from '../../../../../shared/ui/use-active-option.js';
import { pluralRu } from '../../../lib/plural-ru.js';
import { focusName } from '../../../../../shared/ui/panel/panel-kit.js';

/**
 * Имя статуса с мягкими подсказками (#430, ADR-0024 п.7): имена того же
 * системного этапа из опубликованных маршрутов со счётчиком. Это не жёсткий
 * справочник — можно ввести своё; подсказка только помогает не плодить
 * почти-дубли. Список — под полем, клавиатура как у комбобокса.
 */
export function StageNameField({
  value,
  systemState,
  suggestions,
  loading,
  readOnly,
  autoFocus,
  onChange,
}: {
  value: string;
  systemState: TaskSystemState;
  suggestions: readonly WorkflowStageName[];
  loading: boolean;
  readOnly: boolean;
  autoFocus: boolean;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  const query = text.trim().toLowerCase();
  const options = suggestions.filter(
    (s) => s.systemState === systemState && s.name.toLowerCase().includes(query),
  );
  const nav = useActiveOption(options.length, `${open}:${query}`);

  const choose = (name: string) => {
    onChange(name);
    setText(name);
    setOpen(false);
  };

  return (
    <Popover open={open && !readOnly} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="min-w-0 flex-1">
          <Input
            value={text}
            maxLength={40}
            readOnly={readOnly}
            ref={autoFocus ? focusName : undefined}
            onChange={(event) => {
              setText(event.target.value);
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && open) {
                event.preventDefault();
                setOpen(false);
                return;
              }
              nav.onKeyDown(event, {
                onPick: (index) => {
                  const option = options[index];
                  if (option) choose(option.name);
                },
                onOpen: () => setOpen(true),
              });
            }}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-label={ui.automation.stageName}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
        className="w-(--radix-popover-anchor-width) p-1"
      >
        <div className="px-1.5 pt-1 pb-1 text-label-sm font-medium text-muted-foreground uppercase">
          {ui.automation.stageNameSuggestTitle}
        </div>
        <div className="max-h-56 overflow-y-auto">
          {loading ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {ui.automation.stageNameSuggestLoading}
            </p>
          ) : options.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {ui.automation.stageNameSuggestEmpty}
            </p>
          ) : (
            options.map((option, index) => (
              <button
                key={`${option.systemState}:${option.name}`}
                type="button"
                role="option"
                aria-selected={option.name === value}
                data-active={index === nav.active || undefined}
                onClick={() => choose(option.name)}
                onPointerMove={() => nav.setActive(index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent/60',
                  index === nav.active && 'bg-accent/60',
                  option.name === value ? 'text-port' : 'text-secondary-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <span className="shrink-0 text-label-sm text-muted-foreground">
                  {option.routes} {pluralRu(option.routes, ui.automation.stageNameSuggestRoutes)}
                </span>
              </button>
            ))
          )}
        </div>
        <p className="px-1.5 pt-1.5 pb-0.5 text-xs text-muted-foreground">
          {ui.automation.stageNameSuggestFree}
        </p>
      </PopoverContent>
    </Popover>
  );
}
