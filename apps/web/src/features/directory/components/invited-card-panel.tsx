import { useState } from 'react';
import type { InvitationCreated, UserCard } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@nodus/ui/components/empty';

import { useCancelInvitation, useReissueInvitation } from '../api/directory-api.js';
import { InvitationLinkDialog } from './invitation-link-dialog.js';

/** Правая зона карточки приглашённого (#101): вкладок «Чат/Задачи/Проекты»
 *  нет — сотрудник ещё не активировал учётку; вместо них объяснение и
 *  действия администратора. */
export function InvitedCardPanel({
  card,
  canManage,
  onClose,
}: {
  card: UserCard;
  canManage: boolean;
  onClose: () => void;
}) {
  const reissue = useReissueInvitation(card.id);
  const cancel = useCancelInvitation(card.id);
  const [link, setLink] = useState<InvitationCreated | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyTitle>{ui.employees.invitedCardTitle}</EmptyTitle>
          <EmptyDescription>{ui.employees.invitedCardText}</EmptyDescription>
        </EmptyHeader>
        {canManage ? (
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  void reissue
                    .mutateAsync()
                    .then((result) => setLink(result))
                    .catch(() => undefined);
                }}
                disabled={reissue.isPending}
              >
                {ui.employees.inviteReissue}
              </Button>
              <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                {ui.employees.inviteCancel}
              </Button>
            </div>
          </EmptyContent>
        ) : null}
      </Empty>

      {link ? (
        <InvitationLinkDialog
          open
          onOpenChange={(open) => (open ? undefined : setLink(null))}
          title={ui.employees.inviteLinkTitle}
          lead={ui.employees.inviteLinkLead}
          link={`${window.location.origin}${link.path}`}
          expiresAt={link.expiresAt}
        />
      ) : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="w-full sm:max-w-md">
          <DialogTitle>{ui.employees.inviteCancelTitle}</DialogTitle>
          <p className="text-sm text-muted-foreground">{ui.employees.inviteCancelText}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                void cancel
                  .mutateAsync()
                  .then(() => {
                    setCancelOpen(false);
                    onClose();
                  })
                  .catch(() => undefined);
              }}
            >
              {ui.employees.inviteCancelConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
