import { useState } from 'react';
import { createInvitationSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';

/**
 * Приглашение сотрудника (модель Битрикс24, кнопка «Пригласить» в шапке
 * журнала): рабочая почта → POST /directory/invitations. Заготовка под
 * бэкенд директории (полный поток: роль, отдел, письмо-инвайт).
 */
export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = email.trim();
    // Zod-валидация с русским сообщением (аудит #45 — нативная браузерная
    // валидация type=email говорила по-английски; канон форм patterns.md:
    // простая форма = useState + zod-схема contracts для значений).
    if (!createInvitationSchema.safeParse({ email: value }).success) {
      setError(ui.employees.inviteInvalidEmail);
      return;
    }
    if (pending) return;
    setPending(true);
    try {
      await api('/directory/invitations', { method: 'POST', body: { email: value } });
      toast.success(ui.employees.inviteDone);
      setEmail('');
      setError(null);
      onOpenChange(false);
    } catch {
      toast.error(ui.common.sendError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-96">
        <DialogTitle>{ui.employees.inviteTitle}</DialogTitle>
        <form
          noValidate
          className="flex flex-col gap-3 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder={ui.employees.inviteEmailPlaceholder}
            aria-label={ui.employees.inviteTitle}
            aria-invalid={error !== null}
            className="h-8 text-sm"
          />
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          <Button type="submit" disabled={!email.trim() || pending}>
            {ui.employees.inviteSubmit}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
