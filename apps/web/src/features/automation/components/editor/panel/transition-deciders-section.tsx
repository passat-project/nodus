import { X } from 'lucide-react';
import type { CustomFieldKey, DeciderSource, WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
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
import { PanelField } from '../../../../../shared/ui/panel/panel-kit.js';
import { PeoplePicker } from '../../../../../shared/ui/people-picker.js';
import {
  addDeciderSource,
  deciderSourcesOf,
  removeDeciderSource,
  updateDeciderSource,
} from '../../../model/transition-rules.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';

type Rules = WorkflowDraftTransition['rules'];

/**
 * Раздел «Кто жмёт» (#433): решающие вне задачи. Один источник = одно
 * условие `decider_in`; несколько — «любой из» (условия OR). Раздел только
 * для задач: у писем источники запрещены публикацией.
 */
export function DecidersSection({
  transition,
  readOnly,
}: {
  transition: WorkflowDraftTransition;
  readOnly: boolean;
}) {
  const patchTransition = useRouteDocStore((s) => s.patchTransition);
  const positionsQuery = useAllPositions();
  const definitionsQuery = useCustomFieldDefinitions('task');
  const usersQuery = useUsersList();

  const sources = deciderSourcesOf(transition.rules);
  const positions = (positionsQuery.data ?? []).filter((position) => position.isActive);
  const userFields = (definitionsQuery.data ?? []).filter(
    (definition) => definition.type === 'user' || definition.type === 'users',
  );
  const users = usersQuery.data?.items ?? [];

  const patch = (rules: Rules) => patchTransition(transition.id, { rules });

  const add = (kind: DeciderSource['kind']) => {
    switch (kind) {
      case 'position': {
        const position = positions[0];
        if (position) {
          patch(
            addDeciderSource(transition.rules, {
              kind: 'position',
              positionId: position.id,
              positionKind: position.kind,
            }),
          );
        }
        return;
      }
      case 'manager_of':
        patch(addDeciderSource(transition.rules, { kind: 'manager_of', of: 'creator' }));
        return;
      case 'employees':
        patch(addDeciderSource(transition.rules, { kind: 'employees', userIds: [] }));
        return;
      case 'field': {
        const definition = userFields[0];
        if (definition) {
          patch(
            addDeciderSource(transition.rules, {
              kind: 'field',
              field: `cf.${definition.id}` as CustomFieldKey,
            }),
          );
        }
        return;
      }
      case 'project_role':
        patch(addDeciderSource(transition.rules, { kind: 'project_role', role: 'manager' }));
        return;
    }
  };

  const update = (index: number, source: DeciderSource) =>
    patch(updateDeciderSource(transition.rules, index, source));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {sources.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{ui.automation.deciders.summaryEmpty}</p>
      ) : null}

      {sources.map((source, index) => (
        <div
          key={`${source.kind}:${index}`}
          className="flex min-w-0 flex-col gap-2 rounded-md border border-border/60 p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium">
              {ui.automation.deciders.sources[source.kind]}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={readOnly}
              aria-label={ui.automation.deciders.removeSource}
              onClick={() => patch(removeDeciderSource(transition.rules, index))}
            >
              <X />
            </Button>
          </div>

          {source.kind === 'position' ? (
            <>
              <PanelField label={ui.automation.deciders.positionKind.management}>
                <Select
                  value={source.positionKind}
                  disabled={readOnly}
                  onValueChange={(value) =>
                    update(index, {
                      ...source,
                      positionKind: value === 'legal' ? 'legal' : 'management',
                      positionId:
                        positions.find((p) => p.kind === value && p.id === source.positionId)?.id ??
                        positions.find((p) => p.kind === value)?.id ??
                        // Нет должностей нужного вида — оставляем id: проверка
                        // публикации поймает несовпадение вида (диплом-факт).
                        source.positionId,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="management">
                      {ui.automation.deciders.positionKind.management}
                    </SelectItem>
                    <SelectItem value="legal">
                      {ui.automation.deciders.positionKind.legal}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </PanelField>
              <PanelField label={ui.automation.deciders.sources.position}>
                <Select
                  value={source.positionId}
                  disabled={readOnly}
                  onValueChange={(value) => update(index, { ...source, positionId: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={ui.automation.deciders.positionEmpty} />
                  </SelectTrigger>
                  <SelectContent>
                    {positions
                      .filter((position) => position.kind === source.positionKind)
                      .map((position) => (
                        <SelectItem key={position.id} value={position.id}>
                          {position.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </PanelField>
            </>
          ) : null}

          {source.kind === 'manager_of' ? (
            <PanelField label={ui.automation.deciders.sources.manager_of}>
              <Select
                value={source.of}
                disabled={readOnly}
                onValueChange={(value) =>
                  update(index, {
                    kind: 'manager_of',
                    of: value === 'assignee' ? 'assignee' : 'creator',
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="creator">
                    {ui.automation.deciders.managerOf.creator}
                  </SelectItem>
                  <SelectItem value="assignee">
                    {ui.automation.deciders.managerOf.assignee}
                  </SelectItem>
                </SelectContent>
              </Select>
            </PanelField>
          ) : null}

          {source.kind === 'employees' ? (
            <PanelField
              label={ui.automation.deciders.sources.employees}
              hint={source.userIds.length === 0 ? ui.automation.deciders.employeesEmpty : undefined}
            >
              <PeoplePicker
                multiple
                selectedIds={source.userIds}
                ariaLabel={ui.automation.deciders.sources.employees}
                onToggle={(userId) =>
                  update(index, {
                    kind: 'employees',
                    userIds: source.userIds.includes(userId)
                      ? source.userIds.filter((id) => id !== userId)
                      : [...source.userIds, userId],
                  })
                }
              >
                <Button type="button" variant="outline" size="sm" disabled={readOnly}>
                  {source.userIds.length > 0
                    ? source.userIds
                        .map((id) => users.find((user) => user.id === id)?.displayName ?? '…')
                        .join(', ')
                    : ui.automation.deciders.employeesEmpty}
                </Button>
              </PeoplePicker>
            </PanelField>
          ) : null}

          {source.kind === 'field' ? (
            <PanelField
              label={ui.automation.deciders.sources.field}
              hint={userFields.length === 0 ? ui.automation.deciders.fieldNotUser : undefined}
            >
              <Select
                value={source.field}
                disabled={readOnly}
                onValueChange={(value) =>
                  update(index, { kind: 'field', field: value as CustomFieldKey })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={ui.automation.deciders.fieldEmpty} />
                </SelectTrigger>
                <SelectContent>
                  {userFields.map((definition) => (
                    <SelectItem key={definition.id} value={`cf.${definition.id}`}>
                      {definition.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PanelField>
          ) : null}

          {source.kind === 'project_role' ? (
            <PanelField label={ui.automation.deciders.sources.project_role}>
              <Select
                value={source.role}
                disabled={readOnly}
                onValueChange={(value) =>
                  update(index, {
                    kind: 'project_role',
                    role: value as typeof source.role,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['manager', 'assistant', 'participant', 'observer'] as const).map((role) => (
                    <SelectItem key={role} value={role}>
                      {ui.automation.deciders.projectRole[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PanelField>
          ) : null}
        </div>
      ))}

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted-foreground">
          {ui.automation.deciders.addSource}
        </span>
        <Select
          key={sources.length}
          value={undefined}
          disabled={readOnly}
          onValueChange={(value) => add(value as DeciderSource['kind'])}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={ui.automation.deciders.addSource} />
          </SelectTrigger>
          <SelectContent>
            {(['position', 'manager_of', 'employees', 'field', 'project_role'] as const).map(
              (kind) => (
                <SelectItem key={kind} value={kind}>
                  {ui.automation.deciders.sources[kind]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs break-words text-muted-foreground">{ui.automation.deciders.hint}</p>
    </div>
  );
}
