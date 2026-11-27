import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

/** Строка справочника для пикера связей: плитка-значок + имя + тихий чип. */
export interface CatalogPickerItem {
  id: string;
  name: string;
  /** Плитка-значок сущности в грамматике строк «Процессов». */
  icon: ReactNode;
  /** Чип справа (категория, «Системный»…); отсутствует — строки без чипа. */
  badge?: ReactNode;
}

/** Группа справочника («Задачи», «Письма»): подпись показывается, когда
 *  групп больше одной; единственная группа — без заголовка. */
export interface CatalogPickerGroup {
  id: string;
  label: string;
  items: readonly CatalogPickerItem[];
}

/**
 * Окно подключения типов из справочника (#857, модель связей; вердикт
 * владельца 27.11, волна 9): по ЦЕНТРУ, как остальные окна портала, не
 * попап у кнопки. Сверху поиск, ниже — список ещё не подключённых строк
 * (плитка-значок + имя) с ЧЕКБОКСАМИ: можно отметить несколько и подключить
 * одним нажатием. Создания здесь нет — справочник пополняется кнопкой «+»
 * колонки «Процессов».
 */
export function CatalogPicker({
  title,
  groups,
  onConnect,
  open,
  onClose,
}: {
  /** Заголовок окна («Подключить тип задачи»). */
  title: string;
  /** Что можно подключить (потребитель уже отфильтровал подключённое). */
  groups: readonly CatalogPickerGroup[];
  onConnect: (ids: string[]) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  // Закрытие чистит поиск и выбор — во время рендера (канон React, аудит #45).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setQuery('');
      setPicked(new Set());
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        items: q ? group.items.filter((item) => item.name.toLowerCase().includes(q)) : group.items,
      })),
    [groups, q],
  );
  const leftTotal = filtered.reduce((sum, group) => sum + group.items.length, 0);
  const titled = groups.length > 1;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[70vh] max-w-md min-w-80 flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="flex h-14 shrink-0 flex-row items-center border-b border-border px-4">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <div className="shrink-0 border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={ui.common.searchPlaceholder}
              aria-label={ui.common.search}
              className="h-8 pl-8 text-sm"
              autoFocus
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
          {leftTotal === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {q ? ui.automation.entry.searchEmpty : ui.automation.entry.pickerNothingLeft}
            </div>
          ) : (
            filtered.map((group) => (
              <div key={group.id} className="flex flex-col gap-0.5 pb-1">
                {titled && group.items.length > 0 ? (
                  <NodeLabel label={group.label} className="px-2 pt-1.5 pb-0.5" />
                ) : null}
                {group.items.map((item) => {
                  const checked = picked.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent',
                        checked && 'bg-accent/60',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(item.id)}
                        aria-label={item.name}
                      />
                      {item.icon}
                      <span className="min-w-0 flex-1 truncate text-sm" title={item.name}>
                        {item.name}
                      </span>
                      {item.badge}
                    </label>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border px-4">
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button
            disabled={picked.size === 0}
            onClick={() => {
              onConnect([...picked]);
              onClose();
            }}
          >
            {ui.automation.entry.connectAction}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Плитка-значок типа в пикере: тот же вид, что у строки списка «Процессов». */
export function CatalogPickerTile({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md border',
        className,
      )}
    >
      {children}
    </span>
  );
}
