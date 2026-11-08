import type { FormHeight } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { CalendarDays, ChevronDown, Hash, ToggleLeft, Users } from 'lucide-react';

import type { PreviewKind } from './builder-host.js';

const HEIGHT_CLASS: Record<FormHeight, string> = {
  line: 'h-8',
  lines: 'h-20',
  large: 'h-40',
};

const ICONS = {
  select: ChevronDown,
  people: Users,
  date: CalendarDays,
  number: Hash,
  toggle: ToggleLeft,
} as const;

/**
 * Контрол поля в превью редактора (#496): тот же облик, что у окна
 * сотрудника, но без ввода — редактор раскладывает, а не заполняет. Высота
 * многострочного — как выбрана (строка / несколько строк / большое).
 * `span`, а не `div`: превью живёт внутри кнопки «Настроить поле».
 */
export function PreviewControl({ kind, height }: { kind: PreviewKind; height?: FormHeight }) {
  const Icon = kind === 'input' || kind === 'text' ? null : ICONS[kind];
  return (
    <span
      aria-hidden
      className={cn(
        'flex w-full min-w-0 justify-end rounded-lg border border-input px-2.5 dark:bg-input/30',
        kind === 'text'
          ? cn(HEIGHT_CLASS[height ?? 'lines'], 'items-start pt-2')
          : 'h-8 items-center',
      )}
    >
      {Icon ? <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} /> : null}
    </span>
  );
}
