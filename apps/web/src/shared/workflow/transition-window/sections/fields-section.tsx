import type { EffectiveSection, TransitionWindowFieldKey } from '@nodus/contracts';
import { customFieldIdOfKey, formFieldWidth, isFormDecor, ui } from '@nodus/contracts';
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
import {
  FormDecorView,
  FormFieldShell,
  FormGrid,
  type FormGridItem,
} from '../../../forms/form-grid.js';
import { WillLockNotice } from '../../../forms/lock-notice.js';

/**
 * «Поля задачи»: текущие значения, меняются только выбранные в окне.
 * Раскладка окна (#496): общая сетка — половины рядом, подпись и подсказка
 * из окна (иначе имя и подсказка атрибута), метка «Закрепится после «…»».
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
  lockKeys = [],
  transitionName,
}: {
  section: Extract<EffectiveSection, { kind: 'fields' }>;
  context: TransitionWindowContext;
  draft: WindowDraft;
  setFields: (fields: WindowFieldValues) => void;
  disabled: boolean;
  /** Ключи, которые кнопка закрепит после нажатия (#496, Р4) — метка у поля. */
  lockKeys?: readonly string[];
  /** Название кнопки — в метке «Закрепится после «…»». */
  transitionName?: string;
}) {
  const patch = (next: Partial<WindowFieldValues>) => setFields({ ...draft.fields, ...next });
  const editable = !disabled && context.access.canEdit;
  const hasFormula = (key: string) => Boolean(section.formulas?.[key]);
  const locked = new Set(lockKeys);
  const formulaBadge = (
    <span className="text-[10px] leading-none text-info" title={ui.formulas.prefill.badge}>
      fx
    </span>
  );
  const notice = (key: string, showFormula: boolean) =>
    showFormula || locked.has(key) ? (
      <span className="flex items-center gap-1.5">
        {showFormula ? formulaBadge : null}
        {locked.has(key) ? (
          <WillLockNotice text={ui.forms.locks.willLock(transitionName ?? '')} />
        ) : null}
      </span>
    ) : null;

  // Раскладка окна (#496, Р2/Р3): порядок, ширина, подпись и подсказка —
  // из настроенного раздела; поля, которые добавило условие, — в конце.
  const items = section.elements.flatMap((element): FormGridItem[] => {
    if (isFormDecor(element)) {
      return [{ id: element.id, width: 'full', node: <FormDecorView decor={element} /> }];
    }
    const key = element.key;
    const id = customFieldIdOfKey(key);
    if (id === null) {
      return [
        {
          id: key,
          width: formFieldWidth(element),
          node: (
            <FormFieldShell
              label={element.label ?? labelOf(key)}
              hint={element.hint}
              height={key === 'description' ? (element.height ?? 'lines') : undefined}
              notice={notice(key, hasFormula(key))}
            >
              <FieldEditor field={key} value={draft.fields} editable={editable} onChange={patch} />
            </FormFieldShell>
          ),
        },
      ];
    }
    const definition = context.customFieldDefinitions.find((item) => item.id === id);
    if (!definition) return [];
    return [
      {
        id: key,
        width: formFieldWidth(element),
        node: (
          <FormFieldShell
            label={element.label ?? definition.name}
            hint={element.hint ?? definition.hint}
            height={definition.type === 'long_text' ? (element.height ?? 'lines') : undefined}
            notice={notice(
              key,
              hasFormula(key) && draft.fields.customFields[definition.id] != null,
            )}
          >
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
          </FormFieldShell>
        ),
      },
    ];
  });

  return <FormGrid items={items} />;
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
