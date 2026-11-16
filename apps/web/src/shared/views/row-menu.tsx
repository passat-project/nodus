import { Menu } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';
import { uiPx } from '../ui/ui-scale.js';

/** Ширина ведущей колонки журнала (чекбокс выбора + «шашка» меню) —
 *  общая константа DataTable и TaskList: колонки двух таблиц совпадают. */
export const LEADING_COL_W = uiPx(48);

/** Пункт контекстного меню строки журнала. Только РЕАЛЬНЫЕ действия
 *  (заглушек в меню нет — канон): открыть, скопировать ссылку, доменные
 *  мутации вроде «Зарегистрировать» у писем очереди, «В архив»/«Удалить».
 *  Меню строки — ПОЛНЫЙ набор команд сущности, доступных пользователю в этом
 *  контексте (вердикт владельца 25.10.2026): модуль обязан отдать свои
 *  действия следом за базовой парой `makeCardRowMenuItems`. */
export interface RowMenuItem {
  id: string;
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  /** Отбить пункт разделителем (группировка «базовые | доменные»). */
  separatorBefore?: boolean;
  onSelect: () => void;
}

/**
 * «Шашка» строки журнала (три горизонтальные полоски, модель Битрикс24,
 * вердикт владельца 15.09.2026): кнопка контекстного меню сущности в
 * ведущей ячейке строки (рядом с чекбоксом выбора). Меню — DropdownMenu
 * по клику (не ПКМ: журналы — планшетный сценарий тоже). Клики не всплывают
 * до строки (открытие карточки) — остановка на обёртке и триггере.
 * Потребители: DataTable и TaskList — одна механика во всех списках.
 */
export function RowMenu({
  items,
  align = 'start',
}: {
  items: RowMenuItem[];
  /** Сторона выравнивания поповера: у правого края списка — `end`. */
  align?: 'start' | 'end';
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ui.common.rowMenu}
          title={ui.common.rowMenu}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Menu className="size-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44" onClick={(e) => e.stopPropagation()}>
        {items.map((item) => (
          <Fragment key={item.id}>
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              onSelect={item.onSelect}
              className={cn(item.danger && 'text-destructive focus:text-destructive')}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
