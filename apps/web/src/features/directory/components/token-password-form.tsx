import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { AcceptInvitationDto, InvitationInfo, PasswordResetInfo } from '@nodus/contracts';
import {
  ErrorCode,
  errorMessages,
  passwordRuleViolations,
  ui,
  type PasswordRule,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@nodus/ui/components/field';
import { Input } from '@nodus/ui/components/input';

import { ApiError } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';

type PublicTokenInfo = InvitationInfo | PasswordResetInfo;

/** Тексты нарушений политики — общий порядок из contracts (#101). */
const PASSWORD_RULE_MESSAGES: Record<PasswordRule, string> = {
  'too-short': ui.employees.passwordTooShort,
  'too-long': ui.employees.passwordTooLong,
  lower: ui.employees.passwordNeedsLower,
  upper: ui.employees.passwordNeedsUpper,
  digit: ui.employees.passwordNeedsDigit,
  special: ui.employees.passwordNeedsSpecial,
};

function passwordMessage(password: string): string | null {
  const violations = passwordRuleViolations(password);
  if (violations.length === 0) return null;
  return violations.map((rule) => PASSWORD_RULE_MESSAGES[rule]).join(' · ');
}

/** Сервер отклонил именно пароль в общем VALIDATION_FAILED (#101). */
function isPasswordValidationError(error: ApiError): boolean {
  if (error.code !== ErrorCode.VALIDATION_FAILED) return false;
  const issues = Array.isArray(error.details?.issues) ? error.details.issues : [];
  return issues.some(
    (issue) =>
      issue !== null &&
      typeof issue === 'object' &&
      (issue as { path?: unknown }).path === 'password',
  );
}

/**
 * Форма установки пароля по одноразовой ссылке (#101): общая для приглашения
 * и сброса. Требования политики видны под полем, проверка — до запроса;
 * серверная VALIDATION_FAILED по паролю тоже показывается адресно, а не общим
 * «Проверьте правильность заполнения полей». После успеха выходит из текущей
 * сессии (если была) и входит обычным `login` — «авто-вход» без создания
 * сессий в модуле directory (I3/I6).
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
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [switchConfirmed, setSwitchConfirmed] = useState(false);

  const otherUser =
    current !== null && current.email.trim().toLowerCase() !== info.email.trim().toLowerCase();

  async function submit(): Promise<void> {
    setPasswordError(null);
    setRepeatError(null);
    setFormError(null);
    if (password !== repeat) {
      setRepeatError(ui.employees.passwordMismatch);
      return;
    }
    const policyError = passwordMessage(password);
    if (policyError) {
      setPasswordError(policyError);
      return;
    }
    setPending(true);
    try {
      if (current) await logout();
      await onAccept({ email: email.trim().toLowerCase(), password });
      await login(info.email, password);
      await navigate({ to: '/' });
    } catch (err) {
      if (err instanceof ApiError && isPasswordValidationError(err)) {
        setPasswordError(ui.employees.passwordInvalid);
        return;
      }
      const code = err instanceof ApiError ? err.code : ErrorCode.INTERNAL_ERROR;
      setFormError(errorMessages[code as ErrorCode] ?? ui.auth.fallbackError);
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
        <Field data-invalid={passwordError ? true : undefined}>
          <FieldLabel htmlFor="token-password">{ui.employees.invitePagePassword}</FieldLabel>
          <Input
            id="token-password"
            type="password"
            value={password}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={
              passwordError ? 'token-password-hint token-password-error' : 'token-password-hint'
            }
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
            autoComplete="new-password"
          />
          <p id="token-password-hint" className="text-xs text-muted-foreground">
            {ui.employees.invitePagePasswordHint}
          </p>
          {passwordError ? (
            <p id="token-password-error" role="alert" className="text-xs text-destructive">
              {passwordError}
            </p>
          ) : null}
        </Field>
        <Field data-invalid={repeatError ? true : undefined}>
          <FieldLabel htmlFor="token-password-repeat">
            {ui.employees.invitePagePasswordRepeat}
          </FieldLabel>
          <Input
            id="token-password-repeat"
            type="password"
            value={repeat}
            aria-invalid={repeatError ? true : undefined}
            aria-describedby={repeatError ? 'token-password-repeat-error' : undefined}
            onChange={(e) => {
              setRepeat(e.target.value);
              setRepeatError(null);
            }}
            autoComplete="new-password"
          />
          {repeatError ? (
            <p id="token-password-repeat-error" role="alert" className="text-xs text-destructive">
              {repeatError}
            </p>
          ) : null}
        </Field>
      </FieldGroup>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
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
