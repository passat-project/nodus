import {
  Archive,
  CheckCircle2,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  UserCog,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ProjectDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

import { useJoinProject, useLeaveProject } from '../api/project-member-mutations.js';
import { useProjectStatus } from '../api/project-mutations.js';
import { ProjectArchiveDialog } from './project-archive-dialog.js';
import { ProjectEditDialog } from './project-edit-dialog.js';
import { ProjectTransferDialog } from './project-transfer-dialog.js';

/**
 * Действия проекта в шапке карточки (#735, вердикт владельца 10.11.2026):
 * нижнего бара в левой панели больше нет, «О проекте» — обычная вкладка.
 * Слева направо: тихая «Редактировать» (pencil, без primary-заливки),
 * кнопка раскладки вкладок (её передаёт карточка) и меню «⋯» (статусы,
 * передача руководства, присоединиться/покинуть). Права серверные (I8):
 * UI только не показывает недоступное.
 */
export function ProjectHeaderActions({
  project,
  layout,
}: {
  project: ProjectDetail;
  /** Кнопка «Разделить/Соединить области» из карточки (#746). */
  layout?: ReactNode;
}) {
  const status = useProjectStatus();
  const join = useJoinProject(project.id);
  const leave = useLeaveProject(project.id);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const management = project.access.canManage;
  const canAct = management || project.access.canTransfer;
  const hasMenu = canAct || project.access.canJoin || project.access.canLeave;

  return (
    <>
      {project.access.canManage ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setEditOpen(true)}
          aria-label={ui.projects.editProject}
          title={ui.projects.editProject}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3.5" strokeWidth={1.75} />
        </Button>
      ) : null}

      {layout}

      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={ui.projects.actionsTitle}
              title={ui.projects.actionsTitle}
              className="text-muted-foreground"
            >
              <MoreHorizontal className="size-4" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {management && project.status === 'active' ? (
              <DropdownMenuItem
                onClick={() => status.mutate({ id: project.id, status: 'completed' })}
              >
                <CheckCircle2 className="size-3.5" strokeWidth={1.75} />
                {ui.projects.statusComplete}
              </DropdownMenuItem>
            ) : null}
            {management && project.status !== 'archived' ? (
              <DropdownMenuItem variant="destructive" onClick={() => setArchiveOpen(true)}>
                <Archive className="size-3.5" strokeWidth={1.75} />
                {ui.projects.statusArchive}
              </DropdownMenuItem>
            ) : null}
            {management && project.status === 'archived' ? (
              <DropdownMenuItem onClick={() => status.mutate({ id: project.id, status: 'active' })}>
                <RotateCcw className="size-3.5" strokeWidth={1.75} />
                {ui.projects.statusReactivate}
              </DropdownMenuItem>
            ) : null}
            {project.access.canTransfer ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTransferOpen(true)}>
                  <UserCog className="size-3.5" strokeWidth={1.75} />
                  {ui.projects.transfer}
                </DropdownMenuItem>
              </>
            ) : null}
            {project.access.canJoin || project.access.canLeave ? <DropdownMenuSeparator /> : null}
            {project.access.canJoin ? (
              <DropdownMenuItem disabled={join.isPending} onClick={() => join.mutate()}>
                <LogIn className="size-3.5" strokeWidth={1.75} />
                {ui.projects.join}
              </DropdownMenuItem>
            ) : null}
            {project.access.canLeave ? (
              <DropdownMenuItem disabled={leave.isPending} onClick={() => leave.mutate()}>
                <LogOut className="size-3.5" strokeWidth={1.75} />
                {ui.projects.leave}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ProjectArchiveDialog
        name={project.name}
        open={archiveOpen}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => {
          status.mutate({ id: project.id, status: 'archived' });
          setArchiveOpen(false);
        }}
      />
      {transferOpen ? (
        <ProjectTransferDialog project={project} onClose={() => setTransferOpen(false)} />
      ) : null}
      {editOpen ? <ProjectEditDialog project={project} onClose={() => setEditOpen(false)} /> : null}
    </>
  );
}
