import type { CreationFieldSlot, CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Textarea } from '@nodus/ui/components/textarea';
import { cn } from '@nodus/ui/lib/utils';
import { Plus, X } from 'lucide-react';

import { projectsAvailable } from '../api/projects-available.js';
import { useUsersList } from '../api/users-list.js';
import { CustomFieldEditor } from '../custom-fields/value-editor.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { DateTimePicker } from '../ui/date-time-picker.js';
import { PeoplePicker } from '../ui/people-picker.js';
import { ProjectPicker } from '../ui/project-picker.js';
import { FilterCombobox } from '../views/filter-combobox.js';

/**
 * Контролы полей окна создания (#432): системные поля задачи и атрибуты типа.
 * Вынесены из тела формы (I5): тело — раскладка и подписи, здесь — ввод.
 */

/** Контрол поля: тот же и в окне создания, и в редакторе скрытого значения
 *  («Окно создания» — администратор видит ровно то, что увидит сотрудник). */
export function SlotControl({
  slot,
  definition,
  value,
  invalid,
  label,
  onChange,
}: {
  slot: CreationFieldSlot;
  definition: CustomFieldDefinition | undefined;
  value: unknown;
  invalid: boolean;
  label: string;
  onChange: (value: unknown) => void;
}) {
  if (definition) {
    return (
      <div className={cn('min-w-0', invalid && 'rounded-lg ring-1 ring-danger')}>
        <CustomFieldEditor
          definition={definition}
          value={value as never}
          refs={[]}
          variant="form"
          onCommit={(next) => onChange(next)}
        />
      </div>
    );
  }

  switch (slot.key) {
    case 'description':
      return (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            slot.label ? ui.taskCreate.valuePlaceholder : ui.tasks.descriptionPlaceholder
          }
          aria-label={label}
          aria-invalid={invalid || undefined}
          rows={3}
          className={cn('text-sm', invalid && 'border-danger')}
        />
      );
    case 'assignee':
      return <AssigneeField value={value} invalid={invalid} label={label} onChange={onChange} />;
    case 'coexecutors':
    case 'observers':
      return <PeopleField value={value} invalid={invalid} label={label} onChange={onChange} />;
    case 'deadline':
      return (
        <DateTimePicker
          value={typeof value === 'string' ? new Date(value) : null}
          onChange={(date) => onChange(date ? date.toISOString() : null)}
          ariaLabel={label}
        />
      );
    case 'priority':
      return (
        <Select
          value={typeof value === 'string' ? value : 'normal'}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger
            className={cn('h-8 w-full', invalid && 'border-danger')}
            aria-label={label}
            aria-invalid={invalid || undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {(['low', 'normal', 'high', 'urgent'] as const).map((priority) => (
              <SelectItem key={priority} value={priority}>
                {ui.tasks.priority[priority]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'project':
      return projectsAvailable() ? (
        <ProjectPicker
          value={typeof value === 'string' ? value : undefined}
          onChange={(id) => onChange(id ?? null)}
          ariaLabel={label}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{ui.taskCreate.projectUnavailable}</p>
      );
    default:
      return null;
  }
}

function AssigneeField({
  value,
  invalid,
  label,
  onChange,
}: {
  value: unknown;
  invalid: boolean;
  label: string;
  onChange: (value: unknown) => void;
}) {
  const { data: users } = useUsersList();
  const options = (users?.items ?? []).map((user) => ({
    value: user.id,
    label: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
  }));
  return (
    <div className={cn('min-w-0', invalid && 'rounded-lg ring-1 ring-danger')}>
      <FilterCombobox
        options={options}
        value={typeof value === 'string' ? value : undefined}
        onChange={(id) => onChange(id ?? null)}
        ariaLabel={label}
        placeholder={ui.common.notSet}
      />
    </div>
  );
}

/** Соисполнители и наблюдатели: выбранные — чипами, добавление — поповером. */
function PeopleField({
  value,
  invalid,
  label,
  onChange,
}: {
  value: unknown;
  invalid: boolean;
  label: string;
  onChange: (value: unknown) => void;
}) {
  const { data: users } = useUsersList();
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const byId = new Map((users?.items ?? []).map((user) => [user.id, user]));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);

  return (
    <div
      className={cn(
        'flex min-h-8 min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input px-1.5 py-1',
        invalid && 'border-danger',
      )}
    >
      {selected.length === 0 ? (
        <span className="px-1 text-xs text-muted-foreground">{ui.common.notSet}</span>
      ) : (
        selected.map((id) => (
          <span
            key={id}
            className="flex items-center gap-1 rounded-md bg-accent py-0.5 pr-1 pl-0.5 text-xs"
          >
            <PersonAvatar
              name={byId.get(id)?.displayName ?? ''}
              avatarUrl={byId.get(id)?.avatarUrl ?? null}
              className="size-4"
            />
            <span className="max-w-28 truncate">{byId.get(id)?.displayName ?? id}</span>
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-label={`${ui.common.remove}: ${byId.get(id)?.displayName ?? ''}`}
              className="rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </span>
        ))
      )}
      <PeoplePicker selectedIds={selected} multiple ariaLabel={label} onToggle={(id) => toggle(id)}>
        <button
          type="button"
          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`${ui.common.add}: ${label}`}
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      </PeoplePicker>
    </div>
  );
}
