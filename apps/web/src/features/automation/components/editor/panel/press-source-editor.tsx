import type { PressSource, ProcessCategory, WorkflowActorRole } from '@nodus/contracts';

type FieldSource = Extract<PressSource, { kind: 'field' }>;
import { WORKFLOW_ROLES_BY_CATEGORY, ui } from '@nodus/contracts';
import { UserPlus, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { useAllPositions } from '../../../../../shared/api/positions.js';
import { useUsersList } from '../../../../../shared/api/users-list.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { PeoplePicker } from '../../../../../shared/ui/people-picker.js';
import { PersonAvatar } from '../../../../../shared/ui/person-avatar.js';
import { PanelAction, PanelField } from '../../../../../shared/ui/panel/panel-kit.js';
import { CheckRow } from './transition-roles-section.js';

type SourceKind = PressSource['kind'];

const TASK_KINDS: readonly SourceKind[] = [
  'coexecutors',
  'assignee_and_coexecutors',
  'all_employees',
  'role',
  'position',
  'employees',
  'field',
];
const LETTER_KINDS: readonly SourceKind[] = [
  'letter_recipients',
  'all_employees',
  'role',
  'position',
  'employees',
  'field',
];

function labelOf(kind: SourceKind): string {
  return ui.automation.press.sources[kind];
}

/** Источники «кто жмёт» (#434): закрытый реестр, как у решающих. */
export function PressSourcesEditor({
  sources,
  onChange,
  readOnly,
  category,
}: {
  sources: PressSource[];
  onChange: (sources: PressSource[]) => void;
  readOnly: boolean;
  category: ProcessCategory;
}) {
  const positions = useAllPositions().data ?? [];
  const users = useUsersList().data?.items ?? [];
  const definitions = useCustomFieldDefinitions('task').data ?? [];
  const userFields = definitions.filter((d) => d.type === 'user' || d.type === 'users');
  const kinds = category === 'letter' ? LETTER_KINDS : TASK_KINDS;
  const roles = WORKFLOW_ROLES_BY_CATEGORY[category] as readonly WorkflowActorRole[];

  const update = (index: number, next: PressSource) =>
    onChange(sources.map((source, i) => (i === index ? next : source)));

  const add = (kind: SourceKind) => {
    switch (kind) {
      case 'position': {
        const position = positions[0];
        if (position) {
          onChange([
            ...sources,
            { kind: 'position', positionId: position.id, positionKind: position.kind },
          ]);
        }
        return;
      }
      case 'role':
        onChange([...sources, { kind: 'role', roles: [roles[0]!] }]);
        return;
      case 'employees': {
        const user = users[0];
        if (user) onChange([...sources, { kind: 'employees', userIds: [user.id] }]);
        return;
      }
      case 'field': {
        const field = userFields[0];
        if (field) onChange([...sources, { kind: 'field', field: `cf.${field.id}` }]);
        return;
      }
      default:
        onChange([...sources, { kind } as PressSource]);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {sources.map((source, index) => (
        <div
          key={`${source.kind}-${index}`}
          className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 p-2.5"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 text-sm">{labelOf(source.kind)}</span>
            {!readOnly ? (
              <button
                type="button"
                aria-label={ui.common.remove}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onChange(sources.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          {source.kind === 'role' ? (
            <div className="flex flex-col gap-1.5 pl-0.5">
              {roles.map((role) => (
                <CheckRow
                  key={role}
                  checked={source.roles.includes(role)}
                  disabled={readOnly}
                  title={ui.automation.roles[role]}
                  onChange={() => {
                    const next = source.roles.includes(role)
                      ? source.roles.filter((r) => r !== role)
                      : [...source.roles, role];
                    update(index, { kind: 'role', roles: next });
                  }}
                />
              ))}
            </div>
          ) : null}
          {source.kind === 'position' ? (
            <Select
              value={source.positionId}
              disabled={readOnly}
              onValueChange={(positionId) => {
                const position = positions.find((p) => p.id === positionId);
                if (position) {
                  update(index, {
                    kind: 'position',
                    positionId,
                    positionKind: position.kind,
                  });
                }
              }}
            >
              <SelectTrigger className="w-full" aria-label={ui.automation.press.sources.position}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="nokey">
                {positions.map((position) => (
                  <SelectItem key={position.id} value={position.id}>
                    {position.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {source.kind === 'employees' ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {source.userIds.map((id) => {
                const user = users.find((u) => u.id === id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md bg-accent/60 py-0.5 pr-1 pl-0.5 text-xs"
                  >
                    <PersonAvatar name={user?.displayName ?? id} className="size-4" />
                    {user?.displayName ?? id}
                    {!readOnly ? (
                      <button
                        type="button"
                        aria-label={ui.common.remove}
                        className="rounded p-0.5 hover:bg-accent"
                        onClick={() =>
                          update(index, {
                            kind: 'employees',
                            userIds: source.userIds.filter((userId) => userId !== id),
                          })
                        }
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </span>
                );
              })}
              {!readOnly ? (
                <PeoplePicker
                  multiple
                  selectedIds={source.userIds}
                  ariaLabel={ui.automation.press.sources.employees}
                  onToggle={(userId) =>
                    update(index, {
                      kind: 'employees',
                      userIds: source.userIds.includes(userId)
                        ? source.userIds.filter((id) => id !== userId)
                        : [...source.userIds, userId],
                    })
                  }
                >
                  <PanelAction icon={UserPlus}>{ui.automation.press.addEmployee}</PanelAction>
                </PeoplePicker>
              ) : null}
            </div>
          ) : null}
          {source.kind === 'field' ? (
            <Select
              value={source.field}
              disabled={readOnly}
              onValueChange={(field) =>
                update(index, { kind: 'field', field: field as FieldSource['field'] })
              }
            >
              <SelectTrigger className="w-full" aria-label={ui.automation.press.sources.field}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="nokey">
                {userFields.map((field) => (
                  <SelectItem key={field.id} value={`cf.${field.id}`}>
                    {field.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <PanelField label={ui.automation.press.sourcesLabel}>
          <Select value="" onValueChange={(kind) => add(kind as SourceKind)}>
            <SelectTrigger className="w-full" aria-label={ui.automation.press.sourcesLabel}>
              <SelectValue placeholder={ui.automation.press.addSource} />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              {kinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {labelOf(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelField>
      ) : null}
    </div>
  );
}
