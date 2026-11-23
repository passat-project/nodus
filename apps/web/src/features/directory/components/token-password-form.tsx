import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { AcceptInvitationDto, InvitationInfo, PasswordResetInfo } from '@nodus/contracts';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@nodus/ui/components/field';
import { Input } from '@nodus/ui/components/input';

import { ApiError } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';

type PublicTokenInfo = InvitationInfo | PasswordResetInfo;

/**
 * Форма установки пароля по одноразовой ссылке (#101): общая для приглашения
 * и сброса. Сверяет почту (сервер — авторитет), после успеха выходит из
 * текущей сессии (если была) и входит обычным `login` — «авто-вход» без
 * создания сессий в модуле directory (I3/I6).
 */
export function TokenPasswordForm({
  info,
  mode,
  onAccept,
}: {
  info: PublicTokenInfo;
  mode: 'invite' | 'reset';
  onAccept: (body: AcceptInvitationDto) => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const current = useAuthStore((s) => s.user);
  const [email, setEmail] = useState(info.email);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [switchConfirmed, setSwitchConfirmed] = useState(false);

  const otherUser =
    current !== null && current.email.trim().toLowerCase() !== info.email.trim().toLowerCase();

  async function submit(): Promise<void> {
    if (password !== repeat) {
      setError(ui.employees.passwordMismatch);
      return;
    }
    setError(null);
    setPending(true);
    try {
      if (current) await logout();
      await onAccept({ email: email.trim().toLowerCase(), password });
      await login(info.email, password);
      await navigate({ to: '/' });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ErrorCode.INTERNAL_ERROR;
      setError(errorMessages[code as ErrorCode] ?? ui.auth.fallbackError);
    } finally {
      setPending(false);
    }
  }

  if (otherUser && !switchConfirmed) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {ui.employees.invitePageLoggedInAs} <strong>{current?.displayName}</strong>.{' '}
          {ui.employees.invitePageSwitchHint}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void navigate({ to: '/' })}>
            {ui.common.cancel}
          </Button>
          <Button onClick={() => setSwitchConfirmed(true)}>
            {ui.employees.invitePageContinue}
          </Button>
        </div>
      </div>
    );
  }

  const title = mode === 'invite' ? ui.employees.invitePageTitle : ui.employees.resetPageTitle;
  const lead = mode === 'invite' ? ui.employees.invitePageLead : ui.employees.resetPageLead;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>

      {mode === 'invite' ? (
        <p className="text-sm text-foreground">
          <span className="font-medium">{info.displayName}</span>
          {'departmentName' in info && info.departmentName ? ` · ${info.departmentName}` : ''}
          {'positionName' in info && info.positionName ? ` · ${info.positionName}` : ''}
        </p>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="token-email">{ui.employees.invitePageEmail}</FieldLabel>
          <Input
            id="token-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="token-password">{ui.employees.invitePagePassword}</FieldLabel>
          <Input
            id="token-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="token-password-repeat">
            {ui.employees.invitePagePasswordRepeat}
          </FieldLabel>
          <Input
            id="token-password-repeat"
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </FieldGroup>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending
          ? mode === 'invite'
            ? ui.employees.invitePageSubmitting
            : ui.employees.resetPageSubmitting
          : mode === 'invite'
            ? ui.employees.invitePageSubmit
            : ui.employees.resetPageSubmit}
      </Button>
    </form>
  );
}
