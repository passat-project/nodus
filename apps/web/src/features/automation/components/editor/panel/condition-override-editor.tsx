import type { GateOverridePolicy } from '@nodus/contracts';
import { CONDITION_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { useActiveUsersList } from '../../../../../shared/api/users-list.js';
import { PeoplePicker } from '../../../../../shared/ui/people-picker.js';
import { PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';

/** Роли проекта в настройке обхода (#806: должностей нет — сотрудники/роль). */
const PROJECT_ROLES = ['manager', 'assistant', 'participant', 'observer'] as const;
const NO_ROLE = '__none__';

/**
 * Обход проверки (#635): по умолчанию — руководство проекта в своём проекте
 * и обладатели права, с обязательной причиной (история записи и проекта).
 * Можно добавить сотрудников или роль в проекте либо запретить обход —
 * тогда проверку не обойдёт никто, даже обладатели права.
 */
export function OverrideEditor({
  policy,
  readOnly,
  onChange,
}: {
  policy: GateOverridePolicy;
  readOnly: boolean;
  onChange: (patch: Partial<GateOverridePolicy>) => void;
}) {
  const t = ui.automation.condition;
  const usersQuery = useActiveUsersList();
  const users = usersQuery.data?.items ?? [];
  const forbidden = policy.mode === 'forbidden';
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md bg-muted/40 p-2">
      <span className="text-xs font-medium">{t.override}</span>
      <p className="text-xs break-words text-muted-foreground">{t.overrideDefaultHint}</p>
      <SwitchRow
        title={t.overrideForbidden}
        hint={forbidden ? t.overrideForbiddenHint : undefined}
        checked={forbidden}
        disabled={readOnly}
        onChange={(checked) =>
          onChange({
            mode: checked ? 'forbidden' : 'default',
            // Запрет вычищает допуски: после снятия запрета список не
            // «воскресает» из старого черновика.
            extraUserIds: checked ? [] : policy.extraUserIds,
            ...(checked ? { projectRole: undefined } : {}),
          })
        }
      />
      {forbidden ? null : (
        <>
          <PanelField label={t.overrideUsers}>
            <PeoplePicker
              multiple
              selectedIds={policy.extraUserIds}
              ariaLabel={t.overrideUsers}
              onToggle={(userId) =>
                onChange({
                  extraUserIds: policy.extraUserIds.includes(userId)
                    ? policy.extraUserIds.filter((id) => id !== userId)
                    : [...policy.extraUserIds, userId].slice(0, CONDITION_LIMITS.overrideUsers),
                })
              }
            >
              <Button type="button" variant="outline" size="sm" disabled={readOnly}>
                {policy.extraUserIds.length > 0
                  ? policy.extraUserIds
                      .map((id) => users.find((user) => user.id === id)?.displayName ?? '…')
                      .join(', ')
                  : t.overrideUsersEmpty}
              </Button>
            </PeoplePicker>
          </PanelField>
          <PanelField label={t.overrideRole}>
            <Select
              value={policy.projectRole ?? NO_ROLE}
              disabled={readOnly}
              onValueChange={(value) =>
                onChange({
                  projectRole:
                    value === NO_ROLE ? undefined : (value as (typeof PROJECT_ROLES)[number]),
                })
              }
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="nokey">
                <SelectItem value={NO_ROLE}>{t.overrideNoRole}</SelectItem>
                {PROJECT_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ui.automation.deciders.projectRole[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PanelField>
        </>
      )}
    </div>
  );
}
