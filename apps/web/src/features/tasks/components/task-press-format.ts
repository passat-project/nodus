import type { PressEntryView, PressRoundView } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { formatDateTimeShort } from '../../../shared/lib/format.js';

/** Подписи и выгрузка аналитики сбора отметок (#434). */
export function pressStateLabel(entry: PressEntryView): string {
  switch (entry.state) {
    case 'pressed':
      return ui.tasks.press.submitted;
    case 'waiting':
      return ui.tasks.press.waiting;
    case 'returned':
      return ui.tasks.press.returned;
    case 'excluded':
      return ui.tasks.press.excluded;
    case 'withdrawn':
      return ui.tasks.press.withdrawn;
  }
}

export function pressStateClass(entry: PressEntryView): string {
  switch (entry.state) {
    case 'pressed':
      return 'bg-success/15 text-success';
    case 'returned':
      return 'bg-warning/15 text-warning';
    case 'waiting':
      return 'bg-accent text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function downloadPressCsv(press: PressRoundView): void {
  const rows = [
    ['Сотрудник', 'Состояние', 'Когда', 'Результат', 'Причина возврата'],
    ...press.entries.map((entry) => [
      entry.displayName,
      pressStateLabel(entry),
      entry.pressedAt ? formatDateTimeShort(entry.pressedAt) : '',
      entry.result?.text ?? '',
      entry.returnReason ?? '',
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(';'))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Сбор-${press.cycle}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
