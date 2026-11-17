import { Fragment, type ReactNode } from 'react';
import { ChevronUp, CircleSlash, Loader2 } from 'lucide-react';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

/** Одна кнопка слота панели: переход или действие без смены статуса. */
export interface ProcessSlotItem {
  id: string;
  name: string;
  icon: ReactNode;
  /** Кнопка заблокирована гейтом: видна, помечена, объясняет причину. */
  blocked?: boolean;
  /** Человеческий текст причины («Не хватает: …») — строкой в списке. */
  blockedText?: string;
  running?: boolean;
  title?: string;
  /** Показ `menu`: в списке слота — в конце, под разделителем (решение 16.11). */
  rare?: boolean;
  onSelect: () => void;
}

const focusRing =
  'outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30';

/** Высота ряда одна у всех кнопок панели (h-9 = 45px при --ui-scale 1.25). */
const base =
  'inline-flex h-9 min-w-0 items-center gap-2 border border-transparent px-3 text-sm font-medium transition-colors';

/**
 * Слот панели кнопок карточки (решение владельца 16.11.2026): ровно один
 * слот — «главная», «второстепенные» или «действия». Меню «⋯» в панели нет.
 *
 * - одна кнопка в слоте — обычная кнопка, без стрелки;
 * - несколько — первая по порядку нажимается сразу, рядом стрелка вверх
 *   открывает список остальных;
 * - кнопки с показом `menu` (редкие и опасные) стоят в том же списке в конце,
 *   под разделителем; значение `display` в данных не меняется;
 * - заблокированная кнопка в списке показывает причину текстом в самой строке.
 */
export function ProcessButtonSlot({
  items,
  main = false,
  slotLabel,
}: {
  items: readonly ProcessSlotItem[];
  /** Залитая кнопка слота (главная). */
  main?: boolean;
  slotLabel: string;
}) {
  const ordered = [...items.filter((item) => !item.rare), ...items.filter((item) => item.rare)];
  if (ordered.length === 0) return null;
  const [first, ...rest] = ordered;
  if (ordered.length === 1 && first) return <SlotButton item={first} main={main} />;
  if (!first) return null;

  const firstRareIndex = rest.findIndex((item) => item.rare);

  return (
    <DropdownMenu>
      <div className="inline-flex items-stretch" role="group" aria-label={slotLabel}>
        <SlotButton item={first} main={main} attached />
        <DropdownMenuTrigger
          aria-label={slotLabel}
          title={slotLabel}
          className={cn(
            // Разделителя между кнопкой и стрелкой нет (замечание владельца
            // 17.11): полоска «резала» панель рядом с «Приостановить».
            'group/slot inline-flex h-9 w-7 shrink-0 items-center justify-center rounded-r-md border border-transparent text-muted-foreground',
            'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
            focusRing,
          )}
        >
          <ChevronUp
            className="size-3.5 transition-transform duration-150 group-data-[state=open]/slot:rotate-180"
            strokeWidth={1.75}
          />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end" side="top" className="w-auto! max-w-[22rem] min-w-44">
        {rest.map((item, index) => (
          <Fragment key={item.id}>
            {index === firstRareIndex && firstRareIndex > 0 ? <DropdownMenuSeparator /> : null}
            <SlotRow item={item} />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Кнопка слота (одиночная или левая часть сдвоенной). */
function SlotButton({
  item,
  main,
  attached = false,
}: {
  item: ProcessSlotItem;
  main: boolean;
  attached?: boolean;
}) {
  return (
    <button
      type="button"
      aria-busy={item.running || undefined}
      data-blocked={item.blocked || undefined}
      aria-label={item.name}
      title={item.blocked && item.blockedText ? item.blockedText : (item.title ?? item.name)}
      onClick={item.onSelect}
      className={cn(
        base,
        'shrink-0',
        attached ? 'rounded-l-md' : 'rounded-md',
        main
          ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        item.blocked && 'opacity-50',
        focusRing,
      )}
    >
      {item.running ? (
        <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={1.75} />
      ) : (
        item.icon
      )}
      <span className="max-w-64 truncate whitespace-nowrap">{item.name}</span>
    </button>
  );
}

/** Строка списка слота: имя, причина блокировки текстом, маркер. */
function SlotRow({ item }: { item: ProcessSlotItem }) {
  const reasons = item.blocked && item.blockedText ? item.blockedText : null;
  return (
    <DropdownMenuItem
      data-blocked={item.blocked || undefined}
      data-slot-row-id={item.id}
      className="h-auto min-h-9 items-center gap-2 px-2 py-1.5"
      title={reasons ?? item.title ?? item.name}
      onSelect={item.onSelect}
    >
      {item.running ? (
        <Loader2
          className="size-4 shrink-0 animate-spin text-muted-foreground"
          strokeWidth={1.75}
        />
      ) : (
        item.icon
      )}
      <span className={cn('min-w-0 shrink-0 truncate', item.blocked && 'text-muted-foreground')}>
        {item.name}
      </span>
      {reasons ? (
        <span className="ml-auto flex min-w-0 items-center gap-1.5 pl-2">
          <span className="truncate text-xs text-muted-foreground">{reasons}</span>
          <CircleSlash className="size-3.5 shrink-0 text-danger" strokeWidth={1.75} aria-hidden />
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}

/** Подпись слота для меню: одна на панель, без «Ещё ⋯». */
export const processSlotLabels = {
  secondary: ui.tasks.moreActions,
  actions: ui.tasks.actionsMenu,
} as const;
