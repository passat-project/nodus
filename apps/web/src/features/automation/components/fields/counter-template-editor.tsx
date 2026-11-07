import type { CustomFieldDefinition, NumberTemplateSegment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

/**
 * Конструктор вида номера счётчика (#630, §4c): строка сегментов (текст —
 * инпуты, номера/даты/поля — плашки с удалением) и вставка новых сегментов;
 * «длина числа» — добивка нулями counter-плашки. Ровно один «Номер» —
 * вставка второго заблокирована, удаление единственного — ошибка строки
 * (валидация в counter-rule-section). Механика; вкус — ui-writer (1b).
 */
export function CounterTemplateEditor({
  template,
  taskDefinitions,
  disabled,
  onChange,
}: {
  template: readonly NumberTemplateSegment[];
  /** Атрибуты задач — вставки «Поле…» (source='self'; поля проекта — #557). */
  taskDefinitions: readonly CustomFieldDefinition[];
  disabled: boolean;
  onChange: (template: NumberTemplateSegment[]) => void;
}) {
  const counter = template.find((s) => s.kind === 'counter');
  const labelOf = (fieldNumber: number) =>
    taskDefinitions.find((entry) => entry.number === fieldNumber)?.name ?? `№${fieldNumber}`;

  function setSegment(index: number, segment: NumberTemplateSegment | null) {
    onChange(
      template
        .map((entry, i) => (i === index ? segment : entry))
        .filter((entry): entry is NumberTemplateSegment => entry !== null),
    );
  }

  function addSegment(segment: NumberTemplateSegment) {
    onChange([...template, segment]);
  }

  const insert =
    'h-7 rounded-lg border border-dashed border-input px-2.5 text-xs hover:bg-accent/40 disabled:opacity-40';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {template.map((segment, index) =>
          segment.kind === 'literal' ? (
            <Input
              key={index}
              value={segment.text}
              maxLength={50}
              disabled={disabled}
              placeholder={ui.customFields.dialog.counter.literalPlaceholder}
              onChange={(e) => setSegment(index, { kind: 'literal', text: e.target.value || ' ' })}
              onBlur={(e) => {
                if (!e.target.value.trim()) setSegment(index, null);
              }}
              className="h-8 w-24 text-sm"
            />
          ) : (
            <span
              key={index}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-input bg-muted/40 px-2.5 font-mono text-sm"
            >
              {segment.kind === 'counter'
                ? ui.customFields.dialog.counter.segCounter
                : segment.kind === 'year'
                  ? segment.digits === 2
                    ? ui.customFields.dialog.counter.segYear2
                    : ui.customFields.dialog.counter.segYear4
                  : segment.kind === 'month'
                    ? ui.customFields.dialog.counter.segMonth
                    : `${ui.customFields.dialog.counter.segField} ${labelOf(segment.fieldNumber)}`}
              <button
                type="button"
                disabled={disabled}
                aria-label={ui.customFields.dialog.counter.segRemove}
                onClick={() => setSegment(index, null)}
                className="ml-0.5 text-muted-foreground hover:text-danger"
              >
                ×
              </button>
            </span>
          ),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || counter !== undefined}
          onClick={() => addSegment({ kind: 'counter' })}
          className={insert}
        >
          + {ui.customFields.dialog.counter.segCounter}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => addSegment({ kind: 'year', digits: 4 })}
          className={insert}
        >
          + {ui.customFields.dialog.counter.segYear4}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => addSegment({ kind: 'year', digits: 2 })}
          className={insert}
        >
          + {ui.customFields.dialog.counter.segYear2}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => addSegment({ kind: 'month' })}
          className={insert}
        >
          + {ui.customFields.dialog.counter.segMonth}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => addSegment({ kind: 'literal', text: ' ' })}
          className={insert}
        >
          + {ui.customFields.dialog.counter.literalPlaceholder}
        </button>
        <Select
          value=""
          disabled={disabled}
          onValueChange={(fieldNumber) => {
            if (fieldNumber)
              addSegment({ kind: 'field', fieldNumber: Number(fieldNumber), source: 'self' });
          }}
        >
          <SelectTrigger
            className="h-7 w-fit gap-1 border-dashed px-2.5 text-xs"
            aria-label={ui.customFields.dialog.counter.segField}
          >
            <SelectValue placeholder={`+ ${ui.customFields.dialog.counter.segField}`} />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {taskDefinitions.map((definition) => (
              <SelectItem key={definition.id} value={String(definition.number)}>
                {definition.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {counter?.kind === 'counter' ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{ui.customFields.dialog.counter.segCounterLength}:</span>
          <Input
            type="number"
            min={0}
            max={10}
            value={counter.minLength ?? 0}
            disabled={disabled}
            aria-label={ui.customFields.dialog.counter.segCounterLength}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && next >= 0 && next <= 10) {
                onChange(
                  template.map((entry) =>
                    entry.kind === 'counter'
                      ? { ...entry, minLength: next > 0 ? Math.trunc(next) : undefined }
                      : entry,
                  ),
                );
              }
            }}
            className="h-7 w-16 text-sm"
          />
          <span>{ui.customFields.dialog.counter.segCounterLengthHint}</span>
        </label>
      ) : null}
      {counter === undefined ? (
        <p className="text-xs text-danger">{ui.customFields.dialog.counter.templateNeedsCounter}</p>
      ) : null}
    </div>
  );
}
