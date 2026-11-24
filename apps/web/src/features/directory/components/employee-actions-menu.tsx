import { useState } from 'react';
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ShieldMinus,
  ShieldPlus,
  UserCheck,
  UserMinus,
} from 'lucide-react';
import type { InvitationCreated, IssuePasswordResetResponse, UserCard } from '@nodus/contracts';
import { Permission, SystemRole, ui } from '@nodus/contracts';
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
import {
  useActivateUser,
  useCancelInvitation,
  useDeactivateUser,
  useIssuePasswordReset,
  useReissueInvitation,
  useUpdateUser,
} from '../api/directory-api.js';
import { InvitationLinkDialog } from './invitation-link-dialog.js';

type ConfirmAction = 'deactivate' | 'grant' | 'revoke' | 'reset' | 'cancel-invitation';

/**
 * Нижняя полоса профиля (#923) — только левая зона карточки, вне скролла:
 * главная кнопка «Редактировать профиль» и «Действия» для администратора
 * (постоянная иконка «три точки» на любой ширине, меню открывается вверх, к
 * содержимому карточки — вердикт приёмки 18.11.2026). Нет кнопок — нет полосы.
 * «Действия» есть и у приглашённого: управление приглашением живёт здесь, а не
 * кнопками в правой зоне (вердикт владельца 23.11.2026).
 */
export function EmployeeProfileBar({
  card,
  canManage,
  onEdit,
  onCloseCard,
}: {
  card: UserCard;
  canManage: boolean;
  onEdit: () => void;
  /** Отмена приглашения закрывает карточку (действие доступно только в ней). */
  onCloseCard?: () => void;
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
      {canManage ? <EmployeeActionsMenu card={card} onCloseCard={onCloseCard} /> : null}
    </div>
  );
}

/**
 * Действия администратора в «⋯» (вердикты #923 и #101):
 * - активный: уволить / дать–снять администратора / сбросить пароль;
 * - уволенный: только «Вернуть в работу» — после возврата сброс пароля снова
 *   доступен (отдельного «Восстановить доступ» с ссылкой нет, 23.11.2026);
 * - приглашённый: выпустить новую ссылку / отменить приглашение.
 * Себе сброс пароля не показывается и сервер его запрещает
 * (`DIRECTORY_SELF_RESET`); себя уволить нельзя (`DIRECTORY_SELF_DEACTIVATE`).
 * Последнего администратора защищает сервер (`ROLE_LAST_ADMIN`).
 */
export function EmployeeActionsMenu({
  card,
  onCloseCard,
}: {
  card: UserCard;
  onCloseCard?: () => void;
}) {
  const meId = useAuthStore((state) => state.user?.id);
  const isSelf = card.id === meId;
  const { data: roles } = useRoles();
  const adminRole = roles?.find((role) => role.code === SystemRole.ADMIN);
  const isAdmin = card.roles.some((role) => role.code === SystemRole.ADMIN);
  const deactivate = useDeactivateUser(card.id);
  const activate = useActivateUser(card.id);
  const reset = useIssuePasswordReset(card.id);
  const reissue = useReissueInvitation(card.id);
  const cancel = useCancelInvitation(card.id);
  // Сброс пароля — отдельное право `user.manage` (каталог прав): у HR с
  // directory.manage без него пункта не будет (#816).
  const canReset = useAuthStore(
    (state) => state.user?.permissions.includes(Permission.USER_MANAGE) ?? false,
  );
  const [link, setLink] = useState<IssuePasswordResetResponse | InvitationCreated | null>(null);
  const grant = useUpdateUser(card.id, { successMessage: ui.employees.grantAdminDone });
  const revoke = useUpdateUser(card.id, { successMessage: ui.employees.revokeAdminDone });
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const pending =
    deactivate.isPending ||
    grant.isPending ||
    revoke.isPending ||
    reset.isPending ||
    reissue.isPending ||
    cancel.isPending;

  function roleIds(add: boolean, roleId: string): string[] {
    const ids = card.roles.map((role) => role.id).filter((id) => id !== roleId);
    return add ? [...ids, roleId] : ids;
  }

  function run(action: ConfirmAction) {
    if (action === 'deactivate') deactivate.mutate();
    if (action === 'grant' && adminRole) grant.mutate({ roleIds: roleIds(true, adminRole.id) });
    if (action === 'revoke' && adminRole) revoke.mutate({ roleIds: roleIds(false, adminRole.id) });
    if (action === 'reset') {
      // Ссылка выпускается ТОЛЬКО после подтверждения (#101): до него сессии
      // сотрудника не гасятся — случайный клик не выкидывает его из портала.
      void reset
        .mutateAsync()
        .then((result) => setLink(result))
        .catch(() => undefined);
    }
    if (action === 'cancel-invitation') {
      void cancel
        .mutateAsync()
        .then(() => {
          setConfirm(null);
          onCloseCard?.();
        })
        .catch(() => undefined);
    }
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
    reset: {
      title: ui.employees.resetConfirmTitle,
      text: ui.employees.resetConfirmText,
      confirm: ui.employees.resetLink,
    },
    'cancel-invitation': {
      title: ui.employees.inviteCancelTitle,
      text: ui.employees.inviteCancelText,
      confirm: ui.employees.inviteCancelConfirm,
    },
  };
  const current = confirm ? texts[confirm] : null;
  const isInviteLink = link?.path.startsWith('/invite/') ?? false;

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
          {card.status === 'invited' ? (
            <>
              <DropdownMenuItem
                disabled={reissue.isPending}
                onSelect={() => {
                  void reissue
                    .mutateAsync()
                    .then((result) => setLink(result))
                    .catch(() => undefined);
                }}
              >
                <RotateCcw />
                {ui.employees.inviteReissue}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirm('cancel-invitation')}
              >
                <UserMinus />
                {ui.employees.inviteCancel}
              </DropdownMenuItem>
            </>
          ) : card.status === 'active' ? (
            <>
              <DropdownMenuItem
                variant="destructive"
                disabled={isSelf}
                title={isSelf ? ui.employees.selfDeactivateHint : undefined}
                onSelect={() => setConfirm('deactivate')}
              >
                <UserMinus />
                {ui.employees.deactivateEmployee}
              </DropdownMenuItem>
              {adminRole ? (
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
              {canReset && !isSelf ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirm('reset')}>
                    <KeyRound />
                    {ui.employees.resetLink}
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          ) : (
            <DropdownMenuItem onSelect={() => activate.mutate()}>
              <UserCheck />
              {ui.employees.activateEmployee}
            </DropdownMenuItem>
          )}
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
              variant={
                confirm === 'deactivate' || confirm === 'cancel-invitation'
                  ? 'destructive'
                  : 'default'
              }
              disabled={pending}
              onClick={() => confirm && run(confirm)}
            >
              {current?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {link ? (
        <InvitationLinkDialog
          open
          onOpenChange={(open) => (open ? undefined : setLink(null))}
          title={isInviteLink ? ui.employees.inviteLinkTitle : ui.employees.resetLinkDone}
          lead={isInviteLink ? ui.employees.inviteLinkLead : ui.employees.resetLinkLead}
          link={`${window.location.origin}${link.path}`}
          expiresAt={link.expiresAt}
          expiresLabel={
            isInviteLink ? ui.employees.inviteLinkExpires : ui.employees.resetLinkExpires
          }
        />
      ) : null}
    </>
  );
}
