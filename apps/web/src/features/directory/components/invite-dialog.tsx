import { useEffect, useState } from 'react';
import type { InvitationCreated } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nodus/ui/components/dialog';

import { InviteDialogForm } from './invite-dialog-form.js';
import { TokenLinkField } from './invitation-link-dialog.js';

/**
 * Приглашение сотрудника по ссылке (#101): форма (ФИО, почта, должность,
 * подразделение, необязательные ставка и дата приёма) → шаг «ссылка готова».
 * Создаётся пользователь со статусом «Приглашён»; админ передаёт одноразовую
 * ссылку вручную, письма пока нет (#991). Руководитель производный (ADR-0053);
 * разметка формы — `invite-dialog-form`.
 *
 * Шаг «ссылка» сбрасывается НЕ на закрытии, а при следующем открытии: сброс
 * на закрытии перерисовывал контент в форму во время fade-out, `autoFocus`
 * поля «Фамилия» выдёргивал браузерное автозаполнение — по центру на миг
 * появлялось чужое окно (вердикт владельца 23.11.2026).
 */
export function InviteDialog({
  open,
  onOpenChange,
  initialDepartmentId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Предвыбранный отдел из панели/меню подразделения (#881). */
  initialDepartmentId?: string | null;
}) {
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const link = created ? `${window.location.origin}${created.path}` : '';
  // Новое открытие — всегда с формы: сборка сброса перенесена из закрытия.
  useEffect(() => {
    if (open) setCreated(null);
  }, [open]);

  function close(): void {
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="w-full sm:max-w-lg">
        <DialogTitle>
          {created ? ui.employees.inviteLinkTitle : ui.employees.inviteTitle}
        </DialogTitle>
        <DialogDescription>
          {created ? ui.employees.inviteLinkLead : ui.employees.inviteLead}
        </DialogDescription>

        {created ? (
          <div className="flex flex-col gap-4 pt-2">
            <TokenLinkField link={link} />
            <p className="text-sm text-muted-foreground">
              {ui.employees.inviteLinkExpires}{' '}
              <span className="font-medium text-foreground">
                {new Date(created.expiresAt).toLocaleDateString('ru-RU')}
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                {ui.common.close}
              </Button>
            </div>
          </div>
        ) : (
          <InviteDialogForm
            initialDepartmentId={initialDepartmentId}
            onCreated={setCreated}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
