import { useState } from 'react';
import type { ProcessType, ProcessTypeAccess, Role } from '@nodus/contracts';
import { isDefaultProcessType, typeConfigOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';
import { Check, Plus, X } from 'lucide-react';

import { useRoles } from '../../../../../shared/api/roles.js';
import { useUpdateProcessType, useUpdateProcessTypeConfig } from '../../../api/automation-api.js';
import { ModeChoices, PanelField, PanelNote } from '../../../../../shared/ui/panel/panel-kit.js';

/** Режим списка доступа: «всем» (`null` в конфигурации) или роли. */
type ViewMode = 'all' | 'roles';
type CreateMode = 'all' | 'roles' | 'nobody';

const t = ui.automation.typeSettings.access;

/**
 * Раздел «Доступ» настроек типа (#432, В6/Р6; переход внутрь из корня
 * панели): «Кто видит тип» — все или роли; «Кто создаёт задачи» — все, кто
 * видит, роли или «никто, кроме администратора» (`creatable=false`). Выбор
 * — строками с пояснением (длинные подписи в сегментах обрезались —
 * замечание владельца). Администратор видит и создаёт всегда.
 * «Стандартный» заблокирован: по нему создают быстрые входы. Сохраняется
 * сразу, откат — тост из мутации.
 */
export function TypeAccessSection({ type, readOnly }: { type: ProcessType; readOnly: boolean }) {
  const updateConfig = useUpdateProcessTypeConfig(type.id);
  const updateType = useUpdateProcessType();
  const { data: roles, isLoading, isError, refetch } = useRoles();
  const isDefault = isDefaultProcessType(type);
  const locked = isDefault || readOnly;
  const access = typeConfigOf(type).access;

  const viewMode: ViewMode = access.view === null ? 'all' : 'roles';
  const createMode: CreateMode = !type.creatable
    ? 'nobody'
    : access.create === null
      ? 'all'
      : 'roles';

  const save = (next: Partial<ProcessTypeAccess>) =>
    updateConfig.mutate({
      access: {
        view: next.view !== undefined ? next.view : access.view,
        create: next.create !== undefined ? next.create : access.create,
      },
    });

  function setViewMode(mode: ViewMode) {
    if (mode === viewMode) return;
    save({ view: mode === 'all' ? null : [] });
  }

  function setCreateMode(mode: CreateMode) {
    if (mode === createMode) return;
    if (mode === 'nobody') {
      updateType.mutate({ id: type.id, body: { creatable: false } });
      return;
    }
    // `creatable` — свойство типа (прежний PATCH), списки — конфигурация.
    if (!type.creatable) updateType.mutate({ id: type.id, body: { creatable: true } });
    const create = mode === 'all' ? null : (access.create ?? []);
    if (create !== access.create) save({ create });
  }

  function toggleRole(kind: 'view' | 'create', roleId: string) {
    const current = kind === 'view' ? access.view : access.create;
    if (current === null) return;
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId];
    save(kind === 'view' ? { view: next } : { create: next });
  }

  const roleChips = (kind: 'view' | 'create', ids: readonly string[]) => (
    <RoleChips
      roleIds={ids}
      roles={roles}
      disabled={locked}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      onToggle={(roleId) => toggleRole(kind, roleId)}
    />
  );

  return (
    <>
      {isDefault ? <PanelNote>{t.defaultLocked}</PanelNote> : null}

      <PanelField label={t.view}>
        <ModeChoices
          value={viewMode}
          disabled={locked}
          ariaLabel={t.view}
          options={[
            { value: 'all', label: t.viewAll, hint: t.viewAllHint },
            { value: 'roles', label: t.viewRoles, hint: t.viewRolesHint },
          ]}
          onChange={setViewMode}
        />
        {viewMode === 'roles' ? roleChips('view', access.view ?? []) : null}
        {viewMode === 'roles' && (access.view ?? []).length === 0 ? (
          <span className="text-xs text-warning">{t.noViewWarning}</span>
        ) : null}
      </PanelField>

      <PanelField label={t.create}>
        <ModeChoices
          value={createMode}
          disabled={locked}
          ariaLabel={t.create}
          options={[
            { value: 'all', label: t.createAll, hint: t.createAllHint },
            { value: 'roles', label: t.createRoles, hint: t.createRolesHint },
            { value: 'nobody', label: t.createNobody, hint: t.createNobodyHint },
          ]}
          onChange={setCreateMode}
        />
        {createMode === 'roles' ? roleChips('create', access.create ?? []) : null}
        {createMode === 'roles' && (access.create ?? []).length === 0 ? (
          <span className="text-xs text-warning">{t.noCreateWarning}</span>
        ) : null}
      </PanelField>

      <p className="text-xs text-muted-foreground">{t.adminHint}</p>
    </>
  );
}

/** Чипы выбранных ролей + поповер «выбрать роль» (список ролей портала). */
function RoleChips({
  roleIds,
  roles,
  disabled,
  isLoading,
  isError,
  onRetry,
  onToggle,
}: {
  roleIds: readonly string[];
  roles: Role[] | undefined;
  disabled: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onToggle: (roleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map((roles ?? []).map((role) => [role.id, role]));

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {t.rolesError}
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-input px-1.5 py-1">
      {isLoading ? (
        <span className="px-1 text-xs text-muted-foreground">{t.rolesLoading}</span>
      ) : roleIds.length === 0 ? (
        <span className="px-1 text-xs text-muted-foreground">{t.rolesPlaceholder}</span>
      ) : (
        roleIds.map((id) => (
          <span
            key={id}
            className={cn(
              'flex items-center gap-1 rounded-md bg-accent py-0.5 pr-1 pl-1.5 text-xs',
              byId.get(id) ? 'text-foreground' : 'text-muted-foreground line-through',
            )}
          >
            {byId.get(id)?.name ?? id}
            {disabled ? null : (
              <button
                type="button"
                onClick={() => onToggle(id)}
                aria-label={`${ui.common.remove}: ${byId.get(id)?.name ?? id}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            )}
          </span>
        ))
      )}
      {disabled ? null : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t.rolesPlaceholder}
              className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="nokey w-64 p-1.5">
            <div className="flex max-h-64 flex-col overflow-y-auto" data-no-scrollbar>
              {(roles ?? []).length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t.rolesEmpty}
                </p>
              ) : (
                (roles ?? []).map((role) => {
                  const on = roleIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => onToggle(role.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent/60',
                        on ? 'text-foreground' : 'text-secondary-foreground',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{role.name}</span>
                      {on ? (
                        <Check className="size-3.5 shrink-0 text-primary" strokeWidth={1.75} />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
