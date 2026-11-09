import { Plus, Search } from 'lucide-react';
import { useDeferredValue, useState, type ReactNode } from 'react';
import type { Role } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { usePrefetchRoleMembers, useRoleMembers, useToggleRoleMember } from '../api/role-admin.js';
import { flattenDepartments, useDepartmentTreeManagement } from '../api/departments-list.js';
import { useUsersSearch } from '../api/users-list.js';
import { withoutPatronymic } from '../lib/format.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { SEGMENTED_ACTIVE_TONAL, SegmentedControl } from '../ui/segmented-control.js';
import { isLockedRole } from './access-model.js';

type Tab = 'users' | 'departments';

/**
 * Состав роли (модель Битрикс24 «Сотрудники и отделы»): поповер у кнопки
 * «+» в шапке столбца. Один список с флажками — отмеченные входят в роль,
 * клик добавляет/убирает мгновенно (оптимистично). Две вкладки: сотрудники
 * (серверный поиск) и подразделения (их сотрудники получают роль целиком).
 * У «Администратора» вкладки подразделений нет: его состав — только
 * конкретные сотрудники (ADR-0034, п. 5).
 */
export function RoleMembersPopover({ role, canManage }: { role: Role; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('users');
  const [text, setText] = useState('');
  const query = useDeferredValue(text.trim());
  const departmentsAllowed = !isLockedRole(role);
  const activeTab: Tab = departmentsAllowed ? tab : 'users';
  const members = useRoleMembers(role.id, open);
  const prefetch = usePrefetchRoleMembers();
  const people = useUsersSearch(open && activeTab === 'users' ? query : '');
  const tree = useDepartmentTreeManagement();
  const toggle = useToggleRoleMember();

  const memberUsers = new Set((members.data?.users ?? []).map((user) => user.id));
  const memberDepartments = new Set((members.data?.departments ?? []).map((dep) => dep.id));
  const departments = flattenDepartments(tree.data ?? []).filter(
    (dep) => dep.isActive && dep.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${ui.access.membersAdd}: ${role.name}`}
          // Наведение/фокус = намерение открыть: состав уже грузится, флажки
          // появляются сразу отмеченными (без «пустого» кадра).
          onPointerEnter={() => prefetch(role.id)}
          onFocus={() => prefetch(role.id)}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/30"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 p-2">
        <p className="px-1.5 pb-1.5 text-sm font-medium">{ui.access.membersTitle(role.name)}</p>
        {departmentsAllowed ? (
          <SegmentedControl
            value={activeTab}
            options={[
              { value: 'users', label: ui.access.tabUsers },
              { value: 'departments', label: ui.access.tabDepartments },
            ]}
            onChange={(next) => {
              setTab(next);
              setText('');
            }}
            size="sm"
            className="mb-2 w-full [&>button]:flex-1"
            activeClassName={SEGMENTED_ACTIVE_TONAL}
          />
        ) : null}
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={ui.access.searchPlaceholder}
            aria-label={ui.access.searchPlaceholder}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="max-h-64 min-h-40 overflow-y-auto" data-no-scrollbar>
          {members.isPending ? (
            <div className="flex flex-col gap-1.5 p-1.5">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : activeTab === 'users' ? (
            (people.data?.items ?? []).length === 0 ? (
              <Empty />
            ) : (
              people.data!.items.map((user) => {
                const on = memberUsers.has(user.id);
                return (
                  <Row
                    key={user.id}
                    on={on}
                    disabled={!canManage || !members.data}
                    label={withoutPatronymic(user.displayName)}
                    hint={user.positionName ?? undefined}
                    leading={
                      <PersonAvatar
                        name={user.displayName}
                        avatarUrl={user.avatarUrl}
                        className="size-6 shrink-0"
                      />
                    }
                    onToggle={() =>
                      toggle.mutate({
                        roleId: role.id,
                        target: {
                          kind: 'user',
                          ref: {
                            id: user.id,
                            displayName: user.displayName,
                            avatarUrl: user.avatarUrl,
                          },
                        },
                        add: !on,
                      })
                    }
                  />
                );
              })
            )
          ) : departments.length === 0 ? (
            <Empty />
          ) : (
            departments.map((dep) => {
              const on = memberDepartments.has(dep.id);
              return (
                <Row
                  key={dep.id}
                  on={on}
                  disabled={!canManage || !members.data}
                  label={dep.name}
                  indent={dep.depth}
                  onToggle={() =>
                    toggle.mutate({
                      roleId: role.id,
                      target: { kind: 'department', ref: { id: dep.id, name: dep.name } },
                      add: !on,
                    })
                  }
                />
              );
            })
          )}
        </div>
        <p className="px-1.5 pt-2 text-xs text-muted-foreground">
          {departmentsAllowed ? ui.access.membersHint : ui.access.membersAdminHint}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Empty() {
  return (
    <p className="px-2 py-6 text-center text-xs text-muted-foreground">{ui.access.notFound}</p>
  );
}

function Row({
  on,
  disabled,
  label,
  hint,
  leading,
  indent = 0,
  onToggle,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  hint?: string;
  leading?: ReactNode;
  indent?: number;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent/60',
        disabled && 'cursor-default opacity-60',
      )}
      style={{ paddingLeft: `calc(0.375rem + ${indent} * 0.75rem)` }}
    >
      <Checkbox checked={on} disabled={disabled} onCheckedChange={onToggle} aria-label={label} />
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        {hint ? (
          <span className="block truncate text-label-sm text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}
