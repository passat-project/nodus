import { CalendarClock } from 'lucide-react';
import type { TaskSystemState } from '@nodus/contracts';
import { isOpenState, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatIsoDate, toIsoDate } from '../custom-fields/value-format.js';
import { monoCell } from '../ui/person-cell.js';

export const dash = <span className={monoCell}>—</span>;

/** Реквизиты документа корреспондента: «01-12/345 от 20.10.2026». */
export function theirReference(letter: {
  theirNumber: string | null;
  theirDate: string | null;
}): string {
  const date = letter.theirDate ? formatIsoDate(letter.theirDate) : '';
  if (letter.theirNumber && date) {
    return `${letter.theirNumber} ${ui.letters.fields.dateFrom} ${date}`;
  }
  return letter.theirNumber ?? (date ? `${ui.letters.fields.dateFrom} ${date}` : '');
}

/** Срок ответа истёк: календарный день в прошлом, а письмо ещё в работе
 *  (открытая стадия маршрута; закрытое письмо срок не «жжёт»). */
export function isResponseOverdue(
  letter: { responseDeadline: string | null; stage: { systemState: TaskSystemState } },
  today = toIsoDate(new Date()),
): boolean {
  return (
    letter.responseDeadline !== null &&
    letter.responseDeadline < today &&
    isOpenState(letter.stage.systemState)
  );
}

/** Срок ответа письма — календарный день (не момент): истёк — красный чип,
 *  сегодня — оранжевый, иначе — моно-дата; у закрытого письма — нейтрально. */
export function ResponseDeadline({
  deadline,
  state,
}: {
  deadline: string | null;
  state: TaskSystemState;
}) {
  if (!deadline) return dash;
  const today = toIsoDate(new Date());
  const urgent = isOpenState(state);
  const overdue = urgent && deadline < today;
  if (!overdue && !(urgent && deadline === today)) {
    return <span className={monoCell}>{formatIsoDate(deadline)}</span>;
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-label-sm tabular-nums',
        overdue ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
      )}
    >
      <CalendarClock className="size-3.5" aria-hidden />
      {formatIsoDate(deadline)}
      {overdue ? <span className="sr-only">{ui.letters.list.presetOverdue}</span> : null}
    </span>
  );
}

/**
 * ЕДИНЫЙ реестр колонок списка писем (#55; стандарт «модули не отличаются»,
 * образец — `project-table-fields`): журналы «Входящие»/«Исходящие», «Новые»
 * (редизайн #56 — очередь канцелярии тем же каноном) и вкладка «Письма»
 * карточки контрагента — каждый со своим viewKey, реестр один. Порядок по
 * умолчанию — как в журнале регистрации: №, дата, корреспондент, тема, их №
 * и дата, адресат, статус, срок ответа; редкие поля — в шестерёнке. Для
 * `box: 'new'` умолчания другие: у очереди нет номеров — видны отправитель,
 * время поступления и вложения, а у темы — личная точка «я ещё не открывал»
 * (в журналах её нет). Сортировка № — по моменту регистрации (порядок
 * выдачи номеров серии; строковая «Вх-2026/99» > «…/108» врала бы).
 * `counterpartyVisible: false` — внутри карточки контрагента контекст очевиден.
 *
 * `definitions` — реестр атрибутов модуля «Письма» (#632, Р9): атрибуты,
 * привязанные к типам процессов категории `letter`, идут колонками после
 * системных, скрыты по умолчанию (включаются шестерёнкой в группе
 * «Атрибуты»), сортировки не имеют (серверная — #435). Значения — из строки
 * списка (`customFields`/`customFieldRefs`/`customFieldFormulas`), пустое
 * значение — пустая ячейка.
 */
