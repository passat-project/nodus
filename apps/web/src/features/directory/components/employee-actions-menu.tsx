import { useState } from 'react';
import {
  MoreHorizontal,
  Pencil,
  ShieldMinus,
  ShieldPlus,
  UserCheck,
  UserMinus,
} from 'lucide-react';
import type { UserCard } from '@nodus/contracts';
import { SystemRole, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

import { useRoles } from '../../../shared/api/roles.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useActivateUser, useDeactivateUser, useUpdateUser } from '../api/directory-api.js';

type ConfirmAction = 'deactivate' | 'grant' | 'revoke';

/**
 * Нижняя полоса профиля (#923) — только левая зона карточки, вне скролла:
 * главная кнопка «Редактировать профиль» и «Действия» для администратора
 * (постоянная иконка «три точки» на любой ширине, меню открывается вверх, к
 * содержимому карточки — вердикт приёмки 18.11.2026). Нет кнопок — нет полосы.
 */
export function EmployeeProfileBar({
  card,
  canManage,
  onEdit,
}: {
  card: UserCard;
  canManage: boolean;
  onEdit: () => void;
}) {
  const meId = useAuthStore((state) => state.user?.id);
  const isSelf = card.id === meId;
  const editable = isSelf || canManage;
  if (!editable) return null;
  return (
    <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border px-5 @max-[16rem]/zone:px-3">
      {/* Узкая зона (выжата ниже пола профиля 320dp — карточка сжата до пола
          чата, #63): подпись главной уходит, остаётся иконка с aria-label —
          кнопки не вылезают за зону ни на одной ширине. Калибр кнопок — как у
          нижней панели задачи (h-9, 15px): главная в обоих местах нажимается
          одинаково (#923). */}
      <Button
        size="lg"
        className="min-w-0 px-3"
        onClick={onEdit}
        aria-label={ui.employees.editProfile}
      >
        <Pencil className="shrink-0" aria-hidden />
        <span className="hidden truncate @min-[18rem]/zone:inline">{ui.employees.editProfile}</span>
      </Button>
      {canManage ? <EmployeeActionsMenu card={card} /> : null}
    </div>
  );
}

/**
 * Действия администратора над сотрудником (#923): уволить / вернуть в работу /
 * дать–снять администратора. Переводов и «убрать из отдела» здесь нет —
 * структура правится окном профиля. Себя уволить нельзя (кнопка скрыта
 * правилом, сервер отказывает кодом `DIRECTORY_SELF_DEACTIVATE`); последнего
 * администратора защищает сервер (`ROLE_LAST_ADMIN`). Общий компонент для
 * панели структуры (#883).
 */
export function EmployeeActionsMenu({ card }: { card: UserCard }) {
  const meId = useAuthStore((state) => state.user?.id);
  const isSelf = card.id === meId;
  const { data: roles } = useRoles();
  const adminRole = roles?.find((role) => role.code === SystemRole.ADMIN);
  const isAdmin = card.roles.some((role) => role.code === SystemRole.ADMIN);
  const deactivate = useDeactivateUser(card.id);
  const activate = useActivateUser(card.id);
  const grant = useUpdateUser(card.id, { successMessage: ui.employees.grantAdminDone });
  const revoke = useUpdateUser(card.id, { successMessage: ui.employees.revokeAdminDone });
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const pending = deactivate.isPending || grant.isPending || revoke.isPending;

  function roleIds(add: boolean, roleId: string): string[] {
    const ids = card.roles.map((role) => role.id).filter((id) => id !== roleId);
    return add ? [...ids, roleId] : ids;
  }

  function run(action: ConfirmAction) {
    if (action === 'deactivate') deactivate.mutate();
    if (action === 'grant' && adminRole) grant.mutate({ roleIds: roleIds(true, adminRole.id) });
    if (action === 'revoke' && adminRole) revoke.mutate({ roleIds: roleIds(false, adminRole.id) });
    setConfirm(null);
  }

  const texts: Record<ConfirmAction, { title: string; text: string; confirm: string }> = {
    deactivate: {
      title: ui.employees.deactivateTitle,
      text: ui.employees.deactivateText,
      confirm: ui.employees.deactivateConfirm,
    },
    grant: {
      title: ui.employees.grantAdminTitle,
      text: ui.employees.grantAdminText,
      confirm: ui.employees.grantAdmin,
    },
    revoke: {
      title: ui.employees.revokeAdminTitle,
      text: ui.employees.revokeAdminText,
      confirm: ui.employees.revokeAdmin,
    },
  };
  const current = confirm ? texts[confirm] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="lg"
            className="shrink-0 px-2.5 text-muted-foreground"
            aria-label={ui.employees.actions}
            title={ui.employees.actions}
          >
            {/* Три точки — на любой ширине: подпись «Действия» и шеврон
                убраны, меню открывается вверх (вердикт приёмки 18.11.2026). */}
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          {card.status === 'active' ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={isSelf}
              title={isSelf ? ui.employees.selfDeactivateHint : undefined}
              onSelect={() => setConfirm('deactivate')}
            >
              <UserMinus />
              {ui.employees.deactivateEmployee}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => activate.mutate()}>
              <UserCheck />
              {ui.employees.activateEmployee}
            </DropdownMenuItem>
          )}
          {card.status === 'active' && adminRole ? (
            <>
              <DropdownMenuSeparator />
              {isAdmin ? (
                <DropdownMenuItem onSelect={() => setConfirm('revoke')}>
                  <ShieldMinus />
                  {ui.employees.revokeAdmin}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setConfirm('grant')}>
                  <ShieldPlus />
                  {ui.employees.grantAdmin}
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={current !== null} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <DialogContent className="w-full bg-card sm:max-w-md" showCloseButton={false}>
          <DialogTitle className="text-lg leading-tight font-semibold text-foreground">
            {current?.title}
          </DialogTitle>
          {/* Подтверждение адресное: без имени непонятно, кого увольняем
              (в меню карточка могла остаться от прошлого сотрудника). */}
          {current ? (
            <p
              className="-mt-2 min-w-0 truncate text-sm font-medium text-foreground"
              title={card.displayName}
            >
              {card.displayName}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{current?.text}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant={confirm === 'deactivate' ? 'destructive' : 'default'}
              disabled={pending}
              onClick={() => confirm && run(confirm)}
            >
              {current?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
