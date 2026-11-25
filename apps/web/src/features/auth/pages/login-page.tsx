import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { errorMessages, ErrorCode, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@nodus/ui/components/field';
import { Input } from '@nodus/ui/components/input';

import { LogoIcon } from '../../../app/shell/logo-icon.js';
import { ApiError } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { ShellPanel } from '../../../app/shell/shell-panel.js';

/** Страница входа в теме «Инструмент»: плоский фон, панель-нода (M3, issue #4).
 *  В оболочке — строка панели окна сверху (#1038): страница живёт вне каркаса
 *  AppShell, без панели окно оставалось бы без кнопок и drag-зоны. */
export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email.trim(), password);
      await navigate({ to: '/' });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ErrorCode.INTERNAL_ERROR;
      setError(errorMessages[code as ErrorCode] ?? ui.auth.fallbackError);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {isDesktopShell() ? <ShellPanel /> : null}
      <main className="flex flex-1 items-center justify-center p-4">
        <form onSubmit={(e) => void onSubmit(e)} className="node-panel w-full max-w-sm p-8">
          <div className="flex flex-col items-center gap-2">
            <LogoIcon className="size-12 text-foreground" />
            <h1 className="text-2xl font-semibold tracking-wide">{ui.auth.title}</h1>
            <p className="font-mono text-label-sm tracking-[0.16em] text-muted-foreground uppercase">
              {ui.auth.subtitle}
            </p>
          </div>

          <FieldGroup className="mt-6">
            <Field>
              <FieldLabel htmlFor="email">{ui.auth.email}</FieldLabel>
              <Input
                id="email"
                type="email"
                required
                spellCheck={false}
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">{ui.auth.password}</FieldLabel>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </FieldGroup>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="mt-5 w-full" disabled={pending}>
            {pending ? ui.auth.submitting : ui.auth.submit}
          </Button>
        </form>
      </main>
    </div>
  );
}
