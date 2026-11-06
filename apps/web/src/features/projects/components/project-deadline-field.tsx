import { ui } from '@nodus/contracts';

import { DateTimePicker } from '../../../shared/ui/date-time-picker.js';

/** Крайний срок проекта: только дата, НАШ пикер. «Начала» у проекта не
 *  спрашиваем — в проекте есть срок сдачи (вердикт владельца 07.11.2026:
 *  «странный атрибут „Срок начала“ — никто такое не указывает»). */
export function ProjectDeadlineField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <DateTimePicker
      value={fromIsoDate(value)}
      onChange={(date) => onChange(toIsoDate(date))}
      ariaLabel={ui.projects.deadline}
      placeholder={ui.common.pickDate}
      withTime={false}
    />
  );
}

/** Локальная дата → ISO-дата контракта (`YYYY-MM-DD`, без времени). */
export function toIsoDate(date: Date | null): string | null {
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** ISO-дата контракта → локальная полночь для пикера. */
function fromIsoDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00`) : null;
}
