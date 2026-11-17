import { NotebookPen, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';

import { useAssistantMemory, useDeleteAssistantMemory } from '../api/assistant-actions-api.js';

const strings = ui.assistant;

/**
 * Блокнот агента (#900): что ассистент запомнил о сотруднике. Записи делает
 * агент; здесь — только чтение и удаление (архив на сервере). Личные данные:
 * видит только владелец, в другие диалоги не утекают.
 */
export function AssistantMemoryPicker() {
  const [open, setOpen] = useState(false);
  const memory = useAssistantMemory(open);
  const remove = useDeleteAssistantMemory();
  const items = memory.data?.items ?? [];
  const limit = memory.data?.limit ?? 50;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={strings.memoryTitle}
          title={strings.memoryTitle}
        >
          <NotebookPen className="size-4" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <div className="flex items-center justify-between px-1.5 pt-1 pb-1">
          <span className="text-label font-medium text-foreground">{strings.memoryTitle}</span>
          <span className="font-mono text-badge text-muted-foreground tabular-nums">
            {items.length} {strings.memoryCounter} {limit}
          </span>
        </div>
        <p className="px-1.5 pb-1 text-badge text-muted-foreground">{strings.memoryHint}</p>
        <div className="flex max-h-[var(--radix-popover-content-available-height)] flex-col gap-0.5 overflow-y-auto">
          {items.length === 0 ? (
            <span className="px-1.5 py-1.5 text-label text-muted-foreground">
              {strings.memoryEmpty}
            </span>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="group flex items-start gap-1 rounded-md px-1.5 py-1 hover:bg-accent"
              >
                <span className="min-w-0 flex-1 text-label leading-snug text-foreground">
                  {item.text}
                </span>
                <button
                  type="button"
                  aria-label={strings.memoryRemove}
                  title={strings.memoryRemove}
                  onClick={() =>
                    remove.mutate(item.id, {
                      onError: () => toast.error(strings.memoryRemoveError),
                    })
                  }
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
