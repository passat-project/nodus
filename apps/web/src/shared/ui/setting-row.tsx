import type { LucideIcon } from 'lucide-react';

/**
 * Строка настройки в грамматике колонки данных карточки (ADR-0009:
 * «Задача/письмо/проект» — иконка 3.5 muted + метка + значение): метка в
 * колонке `w-44`, контрол — справа. Экран настройки типа живёт рядом с
 * карточками проекта и письма, поэтому повторяет их ряд полей, а не
 * «узкую колонку по центру» (#857, вердикт владельца 26.11.2026).
 */
export function SettingRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-2 flex min-w-0 items-start gap-3 rounded-lg px-2 py-1.5">
      <span className="flex w-44 shrink-0 items-center gap-2 pt-2 text-sm text-muted-foreground">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Верхняя строка содержимого вкладки-списка (канон карточки: `h-14`,
 * горизонтальные поля `px-6`): слева — действие вкладки или поиск, справа —
 * сводка. Вкладки без действий строку не рисуют.
 */
export function TabToolbar({
  children,
  summary,
}: {
  children?: React.ReactNode;
  /** Сводка состояния справа («Доступно 7 из 7»). */
  summary?: React.ReactNode;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-6">
      {children}
      {summary ? (
        <span className="ml-auto shrink-0 text-sm text-muted-foreground tabular-nums">
          {summary}
        </span>
      ) : null}
    </div>
  );
}
