import { ui } from '@nodus/contracts';

import { DateTimePicker } from '../../ui/date-time-picker.js';
import { formatIsoDate, formatIsoDateTime, fromIsoDate, toIsoDate } from '../value-format.js';
import { EditorTrigger, type EditorProps } from './editor-kit.js';

/**
 * Дата и дата-время: пикер Nodus. У «Даты» времени нет (значение —
 * ISO-день, локальная полночь выбранного дня), у «Даты и времени» —
 * ISO UTC, как все даты портала (I7).
 */
export function DateEditor(props: EditorProps) {
  const withTime = props.definition.type === 'datetime';
  const date =
    typeof props.value === 'string'
      ? withTime
        ? new Date(props.value)
        : fromIsoDate(props.value)
      : null;
  const display = typeof props.value === 'string' ? props.value : null;

  function commit(next: Date | null) {
    if (next === null) {
      if (props.value !== undefined && props.value !== null) props.onCommit(null);
      return;
    }
    const value = withTime ? next.toISOString() : toIsoDate(next);
    // Повтор того же дня не считается ручной записью (Р5 #632).
    if (value === props.value) return;
    props.onCommit(value);
  }

  return (
    <DateTimePicker
      value={date}
      onChange={commit}
      ariaLabel={props.definition.name}
      withTime={withTime}
      clearLabel={ui.filters.reset}
      placeholder={ui.customFields.value.empty}
    >
      {props.variant === 'inline' ? (
        <EditorTrigger variant="inline" disabled={props.disabled} ariaLabel={props.definition.name}>
          {display === null ? (
            <span className="text-muted-foreground">{ui.customFields.value.empty}</span>
          ) : (
            <span className="font-mono text-[13px] tabular-nums">
              {withTime ? formatIsoDateTime(display) : formatIsoDate(display)}
            </span>
          )}
        </EditorTrigger>
      ) : undefined}
    </DateTimePicker>
  );
}
