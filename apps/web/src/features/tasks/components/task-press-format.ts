import type { PressEntryView, PressRoundView, PressStatusLabels } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { formatDateTimeShort } from '../../../shared/lib/format.js';

/** Подписи и выгрузка аналитики сбора отметок (#434).
 *  «Ждём» и «Сдано» можно переписать в настройке кнопки (#965): пусто —
 *  стандартный текст интерфейса. */
export function pressStateLabel(entry: PressEntryView, labels?: PressStatusLabels): string {
  switch (entry.state) {
    case 'pressed':
      return labels?.submitted || ui.tasks.press.submitted;
    case 'waiting':
      return labels?.waiting || ui.tasks.press.waiting;
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
    [
      ui.tasks.press.employee,
      ui.tasks.press.status,
      ui.tasks.press.when,
      ui.tasks.press.result,
      ui.tasks.press.returnReasonLabel,
    ],
    ...press.entries.map((entry) => [
      entry.displayName,
      pressStateLabel(entry, press.statusLabels),
      entry.pressedAt ? formatDateTimeShort(entry.pressedAt) : '',
      entry.result?.text ?? '',
      entry.returnReason ?? '',
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\n');
  // BOM: Excel открывает русский текст без кракозябр (#965).
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${ui.tasks.press.csvFileName}-${press.cycle}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Ячейка CSV: кавычки и защита от формул. Участник может написать
 *  `=HYPERLINK(...)`, и Excel исполнит это при открытии — префикс `'`
 *  оставляет текст текстом (CSV injection, security #434). */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}
