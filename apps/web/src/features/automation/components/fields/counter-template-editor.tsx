import type { CustomFieldDefinition, NumberTemplateSegment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';
import { X } from 'lucide-react';

/**
 * Конструктор вида номера счётчика (#630, §4c): строка сегментов и вставка
 * новых. Строка — ОДИН контрол в визуальном языке калькулятора #632
 * (`FormulaLine`): рамка `input`, `bg-card`, моно-данные внутри. Плашки —
 * sans-метки (моно остаётся данным: литералы и предпросмотр), тон плашки
 * говорит о природе сегмента: `primary` — выдаваемый номер, `info` — значение
 * атрибута, нейтральный — календарь. Ровно один «Номер»: вставка второго
 * заблокирована, отсутствие — error-строка (валидация в counter-rule-section).
 */
const CHIP =
  'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-sans text-xs font-medium';

const TONES = {
  counter: 'border-primary/30 bg-primary/10 text-primary',
  year: 'border-input bg-muted text-secondary-foreground',
  month: 'border-input bg-muted text-secondary-foreground',
  field: 'border-info/30 bg-info/10 text-info',
} as const;

const INSERT =
  'h-7 rounded-lg border border-dashed border-input px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-accent/40 hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 disabled:opacity-40';

/** Строка вида номера: сегменты-плашки и редактируемые литералы на месте. */
export function CounterNumberLine({
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
  const counter = ui.customFields.dialog.counter;
  const labelOf = (fieldNumber: number) =>
    taskDefinitions.find((entry) => entry.number === fieldNumber)?.name ?? `№${fieldNumber}`;

  function setSegment(index: number, segment: NumberTemplateSegment | null) {
    onChange(
      template
        .map((entry, i) => (i === index ? segment : entry))
        .filter((entry): entry is NumberTemplateSegment => entry !== null),
    );
  }

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-xl border border-input bg-card px-2.5 py-2">
      {template.map((segment, index) =>
        segment.kind === 'literal' ? (
          // Литерал — не «поле в поле»: текст номера, который правится на
          // месте. Ширина по содержимому (моно → `ch`), пустой — пунктирная
          // подчёркивалка «здесь можно печатать».
          <input
            key={index}
            value={segment.text}
            maxLength={50}
            disabled={disabled}
            aria-label={counter.literalPlaceholder}
            placeholder={counter.literalPlaceholder}
            onChange={(e) => setSegment(index, { kind: 'literal', text: e.target.value || ' ' })}
            onBlur={(e) => {
              if (!e.target.value.trim()) setSegment(index, null);
            }}
            style={{ width: `${Math.min(50, Math.max(2, segment.text.length + 1))}ch` }}
            className={cn(
              'min-w-4 shrink-0 rounded-sm bg-transparent px-0.5 font-mono text-xs tabular-nums outline-none',
              'transition-colors placeholder:text-muted-foreground/60 hover:bg-accent/40',
              'focus:bg-accent/50 focus:ring-1 focus:ring-ring/30',
              segment.text.trim() === '' && 'border-b border-dashed border-input',
            )}
          />
        ) : (
          <span
            key={index}
            className={cn(
              CHIP,
              segment.kind === 'counter'
                ? TONES.counter
                : segment.kind === 'field'
                  ? TONES.field
                  : TONES.year,
            )}
          >
            {segment.kind === 'counter'
              ? counter.segCounter
              : segment.kind === 'year'
                ? segment.digits === 2
                  ? counter.segYear2
                  : counter.segYear4
                : segment.kind === 'month'
                  ? counter.segMonth
                  : `${counter.segField} ${labelOf(segment.fieldNumber)}`}
            <button
              type="button"
              disabled={disabled}
              aria-label={counter.segRemove}
              onClick={() => setSegment(index, null)}
              className="-mr-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm opacity-60 outline-none transition-[color,opacity] hover:text-danger hover:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:opacity-100 disabled:opacity-30"
            >
              <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
            </button>
          </span>
        ),
      )}
    </div>
  );
}

/** Палитра вставок: пунктир — «добавить», тише плашек строки (ось акцентов). */
export function CounterInsertPalette({
  template,
  taskDefinitions,
  disabled,
  onChange,
}: {
  template: readonly NumberTemplateSegment[];
  taskDefinitions: readonly CustomFieldDefinition[];
  disabled: boolean;
  onChange: (template: NumberTemplateSegment[]) => void;
}) {
  const counter = ui.customFields.dialog.counter;
  const hasCounter = template.some((segment) => segment.kind === 'counter');
  const add = (segment: NumberTemplateSegment) => onChange([...template, segment]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Второго «Номера» не бывает — вставка исчезает вместе с плашкой в
          строке, а не висит выключенной (мёртвая кнопка = шум). */}
      {hasCounter ? null : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => add({ kind: 'counter' })}
          className={INSERT}
        >
          + {counter.segCounter}
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        title={counter.segYear4Hint}
        onClick={() => add({ kind: 'year', digits: 4 })}
        className={INSERT}
      >
        + {counter.segYear4}
      </button>
      <button
        type="button"
        disabled={disabled}
        title={counter.segYear2Hint}
        onClick={() => add({ kind: 'year', digits: 2 })}
        className={INSERT}
      >
        + {counter.segYear2}
      </button>
      <button
        type="button"
        disabled={disabled}
        title={counter.segMonthHint}
        onClick={() => add({ kind: 'month' })}
        className={INSERT}
      >
        + {counter.segMonth}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => add({ kind: 'literal', text: ' ' })}
        className={INSERT}
      >
        + {counter.literalPlaceholder}
      </button>
      <Select
        value=""
        disabled={disabled}
        onValueChange={(fieldNumber) => {
          if (fieldNumber) add({ kind: 'field', fieldNumber: Number(fieldNumber), source: 'self' });
        }}
      >
        <SelectTrigger
          className="h-7 w-fit gap-1 border-dashed px-2.5 text-xs text-muted-foreground"
          aria-label={counter.segField}
          title={counter.segFieldHint}
        >
          <SelectValue placeholder={`+ ${counter.segField}`} />
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
  );
}
