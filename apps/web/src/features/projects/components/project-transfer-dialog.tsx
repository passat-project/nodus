import { useState } from 'react';
import type { ProjectDetail, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';

import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { PeoplePicker } from '../../../shared/ui/people-picker.js';
import { useTransferProject } from '../api/project-mutations.js';

/** Передача руководства (Т5): только действующий руководитель; прежний без
 *  иных источников становится наблюдателем-создателем. */
export function ProjectTransferDialog({
  project,
  onClose,
}: {
  project: ProjectDetail;
  onClose: () => void;
}) {
  const transfer = useTransferProject(project.id);
  const [target, setTarget] = useState<UserListItem | null>(null);

  function submit() {
    if (!target || transfer.isPending) return;
    transfer.mutate(
      {
        managerId: target.id,
        manager: {
          id: target.id,
          displayName: target.displayName,
          avatarUrl: target.avatarUrl,
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md sm:max-w-md"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogTitle>{ui.projects.transfer}</DialogTitle>
        <p className="text-sm text-muted-foreground">{ui.projects.transferTo}</p>
        <PeoplePicker
          selectedIds={target ? [target.id] : []}
          excludeIds={project.manager ? [project.manager.id] : []}
          ariaLabel={ui.projects.transferTo}
          onToggle={(_id, user) => setTarget(user ?? null)}
        >
          <button
            type="button"
            aria-label={ui.projects.transferTo}
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-input px-2.5 text-sm hover:bg-accent/40 dark:bg-transparent"
          >
            {target ? (
              <>
                <PersonAvatar
                  name={target.displayName}
                  avatarUrl={target.avatarUrl}
                  className="size-5"
                />
                <span className="truncate">{target.displayName}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{ui.common.notSet}</span>
            )}
          </button>
        </PeoplePicker>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={!target || transfer.isPending} onClick={submit}>
            {ui.projects.transfer}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
