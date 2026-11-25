import { Check, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import type { DepartmentOption } from '../../../shared/api/departments-list.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useTransferEmployee } from '../api/department-actions-api.js';

/**
 * Перевод сотрудника в подразделение из меню «⋯» (#881): список активных
 * сотрудников ИЗ ДРУГИХ подразделений прямо в окне — как в Битриксе, выбор в
 * один клик. Целевое подразделение названо строкой «Перевести в» (в меню
 * карточку мог сменить соседний клик — контекст обязан жить внутри окна).
 *
 * Зона списка — фиксированной высоты (`flex-1` внутри окна фикс-высоты):
 * поиск, смена фильтра и пустой результат не меняют габарит окна (канон
 * пикеров 24.09.2026). В строке — аватар, имя, должность и ТЕКУЩЕЕ
 * подразделение: куда человек переезжает, видно до выбора, без второго шага.
 */
export function MoveEmployeeDialog({
  open,
  onOpenChange,
  department,
  users,
  departmentOptions,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: DepartmentNode;
  users: readonly UserListItem[];
  departmentOptions: readonly DepartmentOption[];
  /** Успешный перевод: страница выбирает целевой узел и подсвечивает строку. */
  onMoved: (userId: string) => void;
}) {
  const transfer = useTransferEmployee();
  const [userId, setUserId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setUserId(null);
    setQuery('');
  }, [open, department.id]);

  const departmentNameById = useMemo(
    () => new Map(departmentOptions.map((option) => [option.id, option.name] as const)),
    [departmentOptions],
  );
  // #946: перевод снимает руководящую роль старого узла — предупреждаем до
  // сохранения, иначе подразделение останется без главы/зама неожиданно.
  const leaderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const option of departmentOptions) {
      if (option.id === department.id) continue;
      if (option.headId) ids.add(option.headId);
      for (const id of option.deputyIds) ids.add(id);
    }
    return ids;
  }, [departmentOptions, department.id]);

  const candidates = useMemo(
    () =>
      users
        .filter((user) => user.status === 'active' && user.departmentId !== department.id)
        .map((user) => {
          const current = user.departmentId
            ? (departmentNameById.get(user.departmentId) ?? user.departmentName ?? '')
            : ui.employees.transferEmployeeNoDepartment;
          const secondary = [user.positionName, current].filter(Boolean).join(' · ');
          return { user, secondary, haystack: `${user.displayName} ${secondary}`.toLowerCase() };
        }),
    [users, department.id, departmentNameById],
  );
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? candidates.filter((candidate) => candidate.haystack.includes(needle))
    : candidates;
  const selectedName = candidates.find((candidate) => candidate.user.id === userId)?.user
    .displayName;
  const leaderElsewhere = userId !== null && leaderIds.has(userId);

  // Предупреждение о снятии роли появляется уже ПОСЛЕ выбора и сужает список —
  // выбранную строку возвращаем в поле зрения (она предмет действия).
  useEffect(() => {
    if (!userId) return;
    // `?.` на scrollIntoView — jsdom тестов его не знает.
    listRef.current
      ?.querySelector(`[data-user-id="${userId}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [userId, leaderElsewhere]);

  function submit() {
    if (!userId || transfer.isPending) return;
    transfer.mutate(
      { userId, departmentId: department.id },
      {
        onSuccess: () => {
          onOpenChange(false);
          onMoved(userId);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(26rem,80vh)] w-full flex-col bg-card sm:max-w-md"
        showCloseButton={false}
      >
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.transferEmployeeTitle}
        </DialogTitle>
        <span className="-mt-2 flex min-w-0 items-baseline gap-2 text-sm">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {ui.employees.transferEmployeeDestination}
          </span>
          <span className="min-w-0 truncate font-medium text-foreground" title={department.name}>
            {department.name}
          </span>
        </span>
        {candidates.length > 0 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={ui.employees.transferEmployeeSearch}
              placeholder={ui.employees.transferEmployeeSearch}
              autoFocus
              className="h-8 pl-7 text-sm"
            />
          </div>
        ) : null}

        {/* Зона списка фиксированной высоты: окно не прыгает при поиске и
            пустом результате — заглушка живёт ВНУТРИ той же зоны. */}
        <ul ref={listRef} className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {candidates.length === 0 ? (
            <li className="my-auto px-2 text-center text-xs text-muted-foreground">
              {ui.employees.transferEmployeeEmpty}
            </li>
          ) : visible.length === 0 ? (
            <li className="my-auto px-2 text-center text-xs text-muted-foreground">
              {ui.employees.transferEmployeeNotFound}
            </li>
          ) : (
            visible.map(({ user, secondary }) => {
              const selected = user.id === userId;
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    data-user-id={user.id}
                    aria-pressed={selected}
                    onClick={() => setUserId(user.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/40',
                      selected && 'bg-accent/60',
                    )}
                  >
                    <PersonAvatar
                      name={user.displayName}
                      avatarUrl={user.avatarUrl}
                      decorative
                      className="size-7 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{user.displayName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {secondary}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="size-4 shrink-0 text-primary" aria-hidden />
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {leaderElsewhere ? (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {ui.employees.transferEmployeeLeaderHint}
          </p>
        ) : null}
        <DialogFooter className="items-center">
          {/* Выбранный виден и при поиске, скрывшем его строку: иначе активная
              «Перевести» действовала бы «вслепую» (кого — не видно в списке). */}
          <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
            {selectedName ? `${ui.employees.transferEmployeeSelected}: ${selectedName}` : ''}
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!userId || transfer.isPending} onClick={submit}>
            {ui.employees.transferEmployeeSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
