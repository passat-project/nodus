import { useParams } from '@tanstack/react-router';
import { ui } from '@nodus/contracts';

import { useAcceptPasswordReset, usePasswordResetInfo } from '../api/invitation-public-api.js';
import { PublicTokenShell } from '../components/public-token-shell.js';
import { TokenPasswordForm } from '../components/token-password-form.js';

/** Публичная страница сброса пароля (#101): `/reset/<token>`, ссылка 24 часа. */
export function PasswordResetPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const info = usePasswordResetInfo(token);
  const accept = useAcceptPasswordReset(token);

  if (info.isLoading) {
    return (
      <PublicTokenShell>
        <p className="text-sm text-muted-foreground">{ui.common.loading}</p>
      </PublicTokenShell>
    );
  }

  if (info.isError || !info.data) {
    return (
      <PublicTokenShell>
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-lg font-semibold text-foreground">{ui.employees.resetPageInvalid}</h1>
          <p className="text-sm text-muted-foreground">{ui.employees.resetPageInvalidHint}</p>
        </div>
      </PublicTokenShell>
    );
  }

  return (
    <PublicTokenShell>
      <TokenPasswordForm
        info={info.data}
        mode="reset"
        onAccept={(body) => accept.mutateAsync(body)}
      />
    </PublicTokenShell>
  );
}
