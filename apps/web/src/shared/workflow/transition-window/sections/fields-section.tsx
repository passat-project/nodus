import type { EffectiveSection, TransitionWindowFieldKey } from '@nodus/contracts';
import { customFieldIdOfKey, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Textarea } from '@nodus/ui/components/textarea';

import { formatDuration, parseDuration } from '../../../lib/minutes.js';
import { useUsersList } from '../../../api/users-list.js';
import { CustomFieldEditor } from '../../../custom-fields/value-editor.js';
import { DateTimePicker } from '../../../ui/date-time-picker.js';
import { PeoplePicker } from '../../../ui/people-picker.js';
import type { WindowDraft } from '../use-window-draft.js';
import type { TransitionWindowContext, WindowFieldValues } from '../window-context.js';

/**
 * «Дозаполнить поля»: текущие значения, меняются только выбранные в окне.
 * Сначала системные поля, затем поля процесса (#431, Р7): редакторы
 * `variant="form"` в той же грамматике, подсказка поля — мелким текстом.
 * Архивные определения в контекст не попадают и не показываются.
 */
export function FieldsSection({
  section,
  context,
  draft,
  setFields,
  disabled,
}: {
  section: Extract<EffectiveSection, { kind: 'fields' }>;
  context: TransitionWindowContext;
  draft: WindowDraft;
  setFields: (fields: WindowFieldValues) => void;
  disabled: boolean;
}) {
  const patch = (next: Partial<WindowFieldValues>) => setFields({ ...draft.fields, ...next });
  const editable = !disabled && context.access.canEdit;
  const systemKeys = section.fields.filter((key) => customFieldIdOfKey(key) === null);
  const customKeys = section.fields.filter((key) => customFieldIdOfKey(key) !== null);
  const hasFormula = (key: string) => Boolean(section.formulas?.[key]);
  const formulaBadge = (
    <span className="text-[10px] leading-none text-info" title={ui.formulas.prefill.badge}>
      fx
    </span>
  );

  return (
    <div className="flex flex-col gap-3">
      {systemKeys.map((field) => (
        <div key={field} className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {labelOf(field)}
            {hasFormula(field) ? formulaBadge : null}
          </span>
          <FieldEditor field={field} value={draft.fields} editable={editable} onChange={patch} />
        </div>
      ))}
      {customKeys.map((key) => {
        const id = customFieldIdOfKey(key);
        const definition = id
          ? context.customFieldDefinitions.find((item) => item.id === id)
          : undefined;
        if (!definition) return null;
        return (
          <div key={key} className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {definition.name}
              {hasFormula(key) && draft.fields.customFields[definition.id] != null
                ? formulaBadge
                : null}
            </span>
            <CustomFieldEditor
              definition={definition}
              value={draft.fields.customFields[definition.id]}
              refs={context.customFieldRefs}
              disabled={!editable}
              variant="form"
              onCommit={(value) => {
                const next = { ...draft.fields.customFields };
                if (value === null) delete next[definition.id];
                else next[definition.id] = value;
                patch({ customFields: next });
              }}
            />
            {definition.hint ? (
              <p className="text-xs text-muted-foreground">{definition.hint}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function labelOf(field: TransitionWindowFieldKey): string {
  switch (field) {
    case 'description':
      return ui.tasks.description;
    case 'deadline':
      return ui.tasks.deadline;
    case 'assignee':
      return ui.tasks.assignee;
    case 'plannedMinutes':
      return ui.tasks.plannedTime;
    default:
      return field;
  }
}

function FieldEditor({
  field,
  value,
  editable,
  onChange,
}: {
  field: TransitionWindowFieldKey;
  value: WindowFieldValues;
  editable: boolean;
  onChange: (next: Partial<WindowFieldValues>) => void;
}) {
  switch (field) {
    case 'description':
      return (
        <Textarea
          value={value.description}
          disabled={!editable}
          maxLength={5000}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={ui.tasks.descriptionPlaceholder}
          aria-label={ui.tasks.description}
          className="min-h-16 text-sm [field-sizing:content]"
        />
      );
    case 'deadline':
      return (
        <DateTimePicker
          value={value.deadline ? new Date(value.deadline) : null}
          onChange={(date) => onChange({ deadline: date ? date.toISOString() : null })}
          ariaLabel={ui.tasks.deadline}
          clearLabel={ui.tasks.removeDeadline}
        >
          <Button type="button" variant="outline" disabled={!editable} className="justify-start">
            {value.deadline
              ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(
                  new Date(value.deadline),
                )
              : ui.tasks.deadline}
          </Button>
        </DateTimePicker>
      );
    case 'assignee':
      return <AssigneeField value={value.assigneeId} editable={editable} onChange={onChange} />;
    case 'plannedMinutes':
      return (
        <MinutesField
          value={value.plannedMinutes}
          editable={editable}
          onChange={(minutes) => onChange({ plannedMinutes: minutes })}
        />
      );
    default:
      return null;
  }
}

function AssigneeField({
  value,
  editable,
  onChange,
}: {
  value: string | null;
  editable: boolean;
  onChange: (next: Partial<WindowFieldValues>) => void;
}) {
  const { data } = useUsersList();
  const current = value ? data?.items.find((u) => u.id === value) : undefined;
  return (
    <PeoplePicker
      selectedIds={value ? [value] : []}
      onToggle={(userId) => onChange({ assigneeId: userId })}
      ariaLabel={ui.tasks.assignee}
    >
      <Button type="button" variant="outline" disabled={!editable} className="justify-start">
        {current ? current.displayName : ui.common.notSet}
      </Button>
    </PeoplePicker>
  );
}

function MinutesField({
  value,
  editable,
  onChange,
}: {
  value: number | null;
  editable: boolean;
  onChange: (minutes: number | null) => void;
}) {
  return (
    <Input
      defaultValue={
        value === null ? '' : formatDuration(value, ui.tasks.hoursShort, ui.tasks.minutesShort)
      }
      readOnly={!editable}
      placeholder={ui.tasks.plannedPlaceholder}
      aria-label={ui.tasks.plannedTime}
      className="h-8 w-40 text-sm"
      onBlur={(e) => onChange(parseDuration(e.target.value))}
    />
  );
}
