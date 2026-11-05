import { Plus, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import type {
  CounterpartyRef,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  ProjectType,
  ProjectVisibility,
} from '@nodus/contracts';
import { projectTypeFormOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';

import { useProjectGroups } from '../../../shared/api/projects-list.js';
import { useUsersList } from '../../../shared/api/users-list.js';
import { CustomFieldTypeIcon } from '../../../shared/custom-fields/field-type-icon.js';
import { definitionsForTarget } from '../../../shared/custom-fields/module-target.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { CustomFieldEditor } from '../../../shared/custom-fields/value-editor.js';
import { DateTimePicker } from '../../../shared/ui/date-time-picker.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { PeoplePicker } from '../../../shared/ui/people-picker.js';
import { SegmentedControl } from '../../../shared/ui/segmented-control.js';
import { useCreateProjectGroup } from '../api/project-catalog-mutations.js';

const triggerClass =
  'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors hover:bg-accent/40 dark:bg-input/30';

/** Один сотрудник (руководитель проекта): поповер со справочником. */
export function ManagerField({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (userId: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const { data: users } = useUsersList();
  const user = users?.items.find((entry) => entry.id === value);
  return (
    <PeoplePicker selectedIds={value ? [value] : []} ariaLabel={label} onToggle={onChange}>
      <button type="button" className={triggerClass} disabled={disabled} aria-label={label}>
        {user ? (
          <>
            <PersonAvatar
              name={user.displayName}
              avatarUrl={user.avatarUrl}
              className="size-5 shrink-0"
            />
            <span className="truncate">{user.displayName}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">{ui.common.notSet}</span>
        )}
      </button>
    </PeoplePicker>
  );
}

/** Несколько людей в поле (помощники, наблюдатели): поле — САМ триггер
 *  выбора (клик по любой точке поля открывает поповер с поиском и списком
 *  снизу — модель Битрикс24), выбранные — чипами с крестиком. Кнопки «+»
 *  справа нет: она сужала поле «лесенкой» (вердикт владельца 07.11.2026). */
export function PeopleMultiField({
  value,
  onChange,
  excludeIds = [],
  label,
  disabled,
}: {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  excludeIds?: readonly string[];
  label: string;
  disabled?: boolean;
}) {
  const { data: users } = useUsersList();
  const byId = new Map((users?.items ?? []).map((user) => [user.id, user]));
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);

  return (
    <PeoplePicker
      selectedIds={value}
      excludeIds={excludeIds}
      multiple
      ariaLabel={label}
      onToggle={(id) => toggle(id)}
    >
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled || undefined}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.currentTarget.click();
        }}
        className={cn(
          'flex min-h-8 w-full min-w-0 cursor-pointer flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 text-sm transition-colors hover:bg-accent/40 dark:bg-input/30',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        {value.length === 0 ? (
          <span className="text-xs text-muted-foreground">{ui.common.notSet}</span>
        ) : (
          value.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded-md bg-accent py-0.5 pr-1 pl-0.5 text-xs"
            >
              <PersonAvatar
                name={byId.get(id)?.displayName ?? ''}
                avatarUrl={byId.get(id)?.avatarUrl ?? null}
                className="size-4"
              />
              <span className="max-w-32 truncate">{byId.get(id)?.displayName ?? id}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(id);
                }}
                aria-label={`${ui.common.remove}: ${byId.get(id)?.displayName ?? ''}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          ))
        )}
      </div>
    </PeoplePicker>
  );
}

/** Портфель: выбор из плоского списка + создание нового на месте. */
export function PortfolioField({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string | null;
  onChange: (portfolioId: string | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const { data: groups } = useProjectGroups();
  const create = useCreateProjectGroup();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const live = (groups ?? []).filter((group) => group.archivedAt === null);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    create.mutate(trimmed, {
      onSuccess: (group) => {
        onChange(group.id);
        setName('');
        setCreating(false);
      },
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Select
          value={value ?? 'none'}
          onValueChange={(next) => onChange(next === 'none' ? null : next)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            <SelectItem value="none">{ui.common.notSet}</SelectItem>
            {live.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={() => setCreating((prev) => !prev)}
          aria-label={ui.projects.portfolioCreate}
          title={ui.projects.portfolioCreate}
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
      {creating ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={ui.projects.portfolioNamePlaceholder}
            aria-label={ui.projects.portfolioCreate}
            className="h-8 min-w-0 flex-1 text-sm"
          />
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {ui.common.create}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Видимость: открытый/секретный; закрыть в секретный может только
 *  руководитель (помощнику опция недоступна — сервер отклонит, I8). */
export function VisibilityField({
  value,
  onChange,
  canMakeSecret,
  label,
  disabled,
}: {
  value: ProjectVisibility;
  onChange: (visibility: ProjectVisibility) => void;
  canMakeSecret: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <SegmentedControl
      ariaLabel={label}
      value={value}
      options={[
        { value: 'open', label: ui.projects.visibility.open },
        { value: 'secret', label: ui.projects.visibility.secret },
      ]}
      onChange={(next) => {
        if (next === 'secret' && !canMakeSecret) return;
        onChange(next);
      }}
      disabled={disabled}
      activeClassName="bg-accent text-foreground"
      className={cn('max-w-64', disabled && 'opacity-60')}
    />
  );
}

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

/** Слияние ссылок значений (выбор в редакторе атрибута): без дублей по
 * «kind:id» — иконки и имена в окне живут до ответа сервера (Р6). */
export function mergeFieldRefs(
  prev: readonly CustomFieldRef[],
  picked: readonly CustomFieldRef[],
): CustomFieldRef[] {
  const map = new Map(prev.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
  for (const ref of picked) map.set(`${ref.kind}:${ref.id}`, ref);
  return [...map.values()];
}

/** Ссылка заказчика из выбора редактора атрибута — витринное поле строки
 * журнала при оптимистичной вставке/патче (в тело мутации не идёт). */
export function counterpartyRefOf(ref: CustomFieldRef | undefined): CounterpartyRef | null {
  return ref ? { id: ref.id, name: ref.name ?? '' } : null;
}

/** Звёздочка обязательного поля — тон действия, прижата к метке (как у
 *  системных полей окон проекта). */
function RequiredMark() {
  return (
    <span aria-hidden className="text-primary">
      *
    </span>
  );
}

/**
 * Строки атрибутов слотов формы типа проекта (#631, Р10): дети сетки окон
 * создания/правки («метка слева — контрол справа»), скрытые слоты не
 * спрашиваются, обязательные — со звёздочкой (кнопку окна блокирует
 * `missingProjectFields` у вызывающего). Показываются атрибуты,
 * привязанные к выбранному типу; многострочный текст — на всю ширину окна.
 */
export function ProjectAttributeRows({
  type,
  values,
  refs,
  onChange,
}: {
  type: ProjectType | null;
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  onChange: (fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) => void;
}) {
  const query = useCustomFieldDefinitions('project');
  const form = projectTypeFormOf(type ?? {});
  const definitions = definitionsForTarget(query.data, 'project', type?.id);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const slots = form.fields.flatMap((slot) => {
    if (slot.state === 'hidden') return [];
    const definition = byId.get(slot.fieldId);
    return definition ? [{ slot, definition }] : [];
  });
  if (slots.length === 0) return null;

  return (
    <>
      {slots.map(({ slot, definition }) => {
        const required = slot.state === 'required';
        const label = (
          <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            <CustomFieldTypeIcon
              type={definition.type}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate" title={definition.name}>
              {definition.name}
            </span>
            {required ? <RequiredMark /> : null}
          </span>
        );
        const editor = (
          <CustomFieldEditor
            definition={definition}
            value={values[definition.id]}
            refs={refs}
            variant="form"
            onCommit={(value, picked) => onChange(definition.id, value, picked)}
          />
        );
        return definition.type === 'long_text' ? (
          <div key={definition.id} className="col-span-2 flex flex-col gap-1.5">
            {label}
            {editor}
          </div>
        ) : (
          <Fragment key={definition.id}>
            {label}
            {editor}
          </Fragment>
        );
      })}
    </>
  );
}
