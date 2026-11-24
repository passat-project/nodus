import { useParams } from '@tanstack/react-router';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../../../shared/api-client.js';
import { useAcceptInvitation, useInvitationInfo } from '../api/invitation-public-api.js';
import { PublicTokenShell } from '../components/public-token-shell.js';
import { TokenPasswordForm } from '../components/token-password-form.js';

/** Публичная страница принятия приглашения (#101): `/invite/<token>`. */
export function InviteAcceptPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const info = useInvitationInfo(token);
  const accept = useAcceptInvitation(token);

  if (info.isLoading) {
    return (
      <PublicTokenShell>
        <p className="text-sm text-muted-foreground">{ui.common.loading}</p>
      </PublicTokenShell>
    );
  }

  if (info.isError || !info.data) {
    const used =
      info.error instanceof ApiError && info.error.code === ErrorCode.INVITATION_ALREADY_USED;
    return (
      <PublicTokenShell>
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {used ? ui.employees.invitePageUsed : ui.employees.invitePageInvalid}
          </h1>
          <p className="text-sm text-muted-foreground">
            {used ? ui.employees.invitePageUsedHint : ui.employees.invitePageInvalidHint}
          </p>
        </div>
      </PublicTokenShell>
    );
  }

  return (
    <PublicTokenShell>
      <TokenPasswordForm
        info={info.data}
        mode="invite"
        onAccept={(body) => accept.mutateAsync(body)}
      />
    </PublicTokenShell>
  );
}
