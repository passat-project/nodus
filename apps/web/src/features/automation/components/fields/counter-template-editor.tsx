import type {
  CustomFieldDefinition,
  NumberFieldSegment,
  NumberFieldSource,
  NumberTemplateSegment,
} from '@nodus/contracts';
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

import { fill, type ContainerNames } from '../../lib/counter-rule.js';

/**
 * Конструктор вида номера счётчика (#630, модель v3): строка сегментов и
 * вставка новых. Строка — ОДИН контрол в визуальном языке калькулятора #632
 * (`FormulaLine`): рамка `input`, `bg-card`, моно-данные внутри. Плашки —
 * sans-метки (моно остаётся данным: литералы и предпросмотр), тон плашки
 * говорит о природе сегмента: `primary` — выдаваемый номер, `info` — значение
 * атрибута, нейтральный — календарь. Ровно один «Номер»: вставка второго
 * исчезает, отсутствие — error-строка (валидация в counter-section).
 */
const CHIP =
  'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-sans text-xs font-medium';

const TONES = {
  counter: 'border-primary/30 bg-primary/10 text-primary',
  date: 'border-input bg-muted text-secondary-foreground',
  field: 'border-info/30 bg-info/10 text-info',
} as const;

const INSERT =
  'h-7 rounded-lg border border-dashed border-input px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-accent/40 hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 disabled:opacity-40';

/** Группа палитры «Поле…»: источник значения и его атрибуты. */
export type SegmentFieldGroup =
  | { source: Exclude<NumberFieldSource, 'folder'>; fields: readonly CustomFieldDefinition[] }
  | {
      source: 'folder';
      nodeKindId: string;
      kindName: string;
      fields: readonly CustomFieldDefinition[];
    };

function RemoveSegmentButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ui.customFields.dialog.counter.segRemove}
      onClick={onClick}
      className="-mr-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm outline-none transition-colors hover:text-danger focus-visible:text-danger focus-visible:ring-1 focus-visible:ring-ring/40 disabled:opacity-30"
    >
      <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
    </button>
  );
}

/** Подпись источника поля-вставки: «Поле проекта», «Поле папки «Комплект»». */
function sourceLabel(segment: NumberFieldSegment, names: ContainerNames): string {
  const sources = ui.customFields.dialog.counter.segFieldSources;
  if (segment.source === 'folder') {
    return fill(sources.folder, { name: names.nodeKind(segment.nodeKindId ?? '') ?? '—' });
  }
  return sources[segment.source];
}

function chipLabel(
  segment: Exclude<NumberTemplateSegment, { kind: 'literal' }>,
  labelOf: (fieldNumber: number) => string,
  names: ContainerNames,
): string {
  const counter = ui.customFields.dialog.counter;
  switch (segment.kind) {
    case 'counter':
      return counter.segCounter;
    case 'year':
      return segment.digits === 2 ? counter.segYear2 : counter.segYear4;
    case 'quarter':
      return counter.segQuarter;
    case 'month':
      return counter.segMonth;
    case 'day':
      return counter.segDay;
    case 'field':
      return `${sourceLabel(segment, names)} · ${labelOf(segment.fieldNumber)}`;
  }
}

/** Строка вида номера: сегменты-плашки и редактируемые литералы на месте. */
export function CounterNumberLine({
  template,
  definitions,
  names,
  disabled,
  onChange,
}: {
  template: readonly NumberTemplateSegment[];
  /** Атрибуты портала — подпись вставок «Поле…» по внутреннему номеру. */
  definitions: readonly CustomFieldDefinition[];
  names: ContainerNames;
  disabled: boolean;
  onChange: (template: NumberTemplateSegment[]) => void;
}) {
  const counter = ui.customFields.dialog.counter;
  const labelOf = (fieldNumber: number) =>
    definitions.find((entry) => entry.number === fieldNumber)?.name ?? `№${fieldNumber}`;

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
          <span key={index} className={cn(CHIP, TONES.date)}>
            <input
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
              className="min-w-4 shrink-0 rounded-sm bg-transparent px-0.5 font-mono text-xs font-medium text-foreground tabular-nums outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring/30"
            />
            <RemoveSegmentButton disabled={disabled} onClick={() => setSegment(index, null)} />
          </span>
        ) : (
          <span
            key={index}
            title={segment.kind === 'field' ? counter.segFieldEmptyHint : undefined}
            className={cn(
              CHIP,
              segment.kind === 'counter'
                ? TONES.counter
                : segment.kind === 'field'
                  ? TONES.field
                  : TONES.date,
            )}
          >
            {chipLabel(segment, labelOf, names)}
            <RemoveSegmentButton disabled={disabled} onClick={() => setSegment(index, null)} />
          </span>
        ),
      )}
    </div>
  );
}

const DATE_INSERTS: readonly {
  segment: NumberTemplateSegment;
  label: keyof typeof ui.customFields.dialog.counter;
  hint: keyof typeof ui.customFields.dialog.counter;
}[] = [
  { segment: { kind: 'year', digits: 4 }, label: 'segYear4', hint: 'segYear4Hint' },
  { segment: { kind: 'year', digits: 2 }, label: 'segYear2', hint: 'segYear2Hint' },
  { segment: { kind: 'quarter' }, label: 'segQuarter', hint: 'segQuarterHint' },
  { segment: { kind: 'month' }, label: 'segMonth', hint: 'segMonthHint' },
  { segment: { kind: 'day' }, label: 'segDay', hint: 'segDayHint' },
];

/** Ключ пункта палитры полей: источник · вид папки · номер атрибута. */
const fieldKey = (group: SegmentFieldGroup, fieldNumber: number) =>
  `${group.source}|${group.source === 'folder' ? group.nodeKindId : ''}|${fieldNumber}`;

/** Палитра вставок: пунктир — «добавить», тише плашек строки (ось акцентов). */
export function CounterInsertPalette({
  template,
  fieldGroups,
  disabled,
  onChange,
}: {
  template: readonly NumberTemplateSegment[];
  fieldGroups: readonly SegmentFieldGroup[];
  disabled: boolean;
  onChange: (template: NumberTemplateSegment[]) => void;
}) {
  const counter = ui.customFields.dialog.counter;
  const hasCounter = template.some((segment) => segment.kind === 'counter');
  const add = (segment: NumberTemplateSegment) => onChange([...template, segment]);
  const groupTitle = (group: SegmentFieldGroup) =>
    group.source === 'folder'
      ? fill(counter.segFieldSources.folder, { name: group.kindName })
      : counter.segFieldSources[group.source];

  function addField(key: string) {
    const [source, nodeKindId, fieldNumber] = key.split('|');
    if (!source || !fieldNumber) return;
    add({
      kind: 'field',
      fieldNumber: Number(fieldNumber),
      source: source as NumberFieldSource,
      ...(source === 'folder' && nodeKindId ? { nodeKindId } : {}),
    });
  }

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
      {DATE_INSERTS.map((entry) => (
        <button
          key={entry.label}
          type="button"
          disabled={disabled}
          title={counter[entry.hint] as string}
          onClick={() => add(entry.segment)}
          className={INSERT}
        >
          + {counter[entry.label] as string}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => add({ kind: 'literal', text: ' ' })}
        className={INSERT}
      >
        + {counter.literalPlaceholder}
      </button>
      {fieldGroups.length > 0 ? (
        <Select value="" disabled={disabled} onValueChange={addField}>
          <SelectTrigger
            className="h-7 w-fit gap-1 border-dashed px-2.5 text-xs text-muted-foreground"
            aria-label={counter.segField}
            title={counter.segFieldHint}
          >
            <SelectValue placeholder={`+ ${counter.segField}`} />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {fieldGroups.flatMap((group) =>
              group.fields.map((definition) => (
                <SelectItem
                  key={fieldKey(group, definition.number)}
                  value={fieldKey(group, definition.number)}
                >
                  <span className="text-muted-foreground">{groupTitle(group)} · </span>
                  {definition.name}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
