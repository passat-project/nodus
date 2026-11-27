import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Строка единой колонки «Процессов» (#857) — та же грамматика, что у
 * списков типов: плитка-значок + название + мета, меню «⋯» по ховеру.
 * Компонент не знает категорию: плитку, метки и меню передаёт колонка.
 */
export function UnifiedTypeRow({
  tile,
  name,
  meta,
  selected,
  archived,
  badges,
  menu,
  onClick,
}: {
  tile: ReactNode;
  name: string;
  meta?: string;
  selected: boolean;
  archived: boolean;
  /** Точечные метки после имени (черновик, «Системный», «Скрыт»). */
  badges?: ReactNode;
  menu?: ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onClick}
        aria-current={selected || undefined}
        className={cn(
          'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors',
          selected ? 'bg-accent' : 'hover:bg-accent/40',
          archived && 'text-muted-foreground',
        )}
      >
        {tile}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{name}</span>
            {badges}
          </span>
          {meta ? (
            <span
              className="mt-0.5 block truncate text-label-sm text-muted-foreground"
              title={meta}
            >
              {meta}
            </span>
          ) : null}
        </span>
      </button>
      {menu ? (
        <span
          className={cn(
            'absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100',
            selected && 'opacity-100',
          )}
        >
          {menu}
        </span>
      ) : null}
    </div>
  );
}

/** Заголовок группы колонки: только сворачивание и счётчик. Создание живёт
 *  в ПУСТОМ состоянии группы (вердикт владельца 26.11.2026: «+» в заголовке
 *  отвергнут — колонка остаётся списком, а не панелью инструментов). */
export function UnifiedGroupHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-1 pr-1 pl-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-accent/40"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        )}
        <NodeLabel label={label} count={count} className="min-w-0 truncate" />
      </button>
    </div>
  );
}

/** Плитка-значок строки (общая грамматика списков «Процессов»). */
export function UnifiedTypeTile({
  tileClass,
  children,
}: {
  tileClass: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg border',
        tileClass,
      )}
    >
      {children}
    </span>
  );
}

/** Пустая группа: тихая заглушка — создание живёт у «+» шапки колонки
 *  (модель связей #857, вердикт владельца 27.11: одна точка создания). */
export function UnifiedGroupEmpty() {
  return (
    <div className="px-2.5 pt-1 pb-2 text-xs text-muted-foreground">
      {ui.automation.entry.emptyGroup}
    </div>
  );
}
