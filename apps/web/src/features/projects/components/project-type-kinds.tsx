import { useState } from 'react';
import { Check, Plus, RotateCcw } from 'lucide-react';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import {
  allowedNodeKinds,
  typeAllowedInProjectType,
  typeConfigOf,
  ui,
  withProjectTypeAllowed,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Switch } from '@nodus/ui/components/switch';

import { PanelAction, PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { kindIdsAfterToggle, visibleTypeKinds } from '../lib/project-type-summary.js';
import { useCreateNodeKind } from '../node-kinds/api/node-kinds-api.js';
import { kindRowSummary } from '../node-kinds/components/node-kind-summary.js';
import { NodeKindTile } from '../../../shared/ui/node-kind-icon.js';
import { WorkspacePageHeader } from './workspace-page-header.js';

/**
 * Страница «Какие папки здесь бывают» (#556; страница рабочей области
 * типа — #857): какие типы справочника доступны папкам проектов этого
 * типа. `null` в `kindIds` — все типы; снятие делает список явным, возврат
 * к полному набору снова пишет `null`. Снятый тип не ломает уже созданные
 * папки. Клик по строке открывает экран типа папки.
 */
export function ProjectTypeKindsPage({
  type,
  kinds,
  canSetup,
  onBack,
  onOpenKind,
}: {
  type: ProjectType;
  kinds: NodeKind[];
  canSetup: boolean;
  onBack: () => void;
  onOpenKind: (id: string) => void;
}) {
  const update = useUpdateProjectType();
  const createKind = useCreateNodeKind();
  const tasks = useLiveProcessTypes('task');
  const letters = useLiveProcessTypes('letter');
  const updateTypeScope = useUpdateTypeCreation();
  const canManageWorkflows = useCanManageWorkflows();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const visible = visibleTypeKinds(type, kinds);
  const allowed = allowedNodeKinds(type.kindIds, visible);
  const allowedIds = allowed.map((kind) => kind.id);
  const explicit = type.kindIds !== null;

  // «Отметил тип — предложено разрешить привязанные типы работ» (#665):
  // у включённого типа есть работы, выключенные в этом типе проекта.
  const boundWorks = [...(tasks.data ?? []), ...(letters.data ?? [])].filter((item) => {
    const scope = typeConfigOf(item).creation;
    return (
      scope.folderKindId !== null &&
      allowedIds.includes(scope.folderKindId) &&
      !typeAllowedInProjectType(scope, type.id)
    );
  });

  function allowBoundWorks(): void {
    for (const item of boundWorks) {
      updateTypeScope.mutate({
        typeId: item.id,
        creation: withProjectTypeAllowed(typeConfigOf(item).creation, type.id, true),
      });
    }
  }

  function toggle(kindId: string, bound: boolean) {
    update.mutate({
      id: type.id,
      kindIds: kindIdsAfterToggle(type.kindIds, visible, kindId, bound),
    });
  }

  function createAndBind() {
    const name = newName.trim();
    if (!name) return;
    createKind.mutate(
      { name, icon: 'folder', color: 'blue' },
      {
        onSuccess: (kind) => {
          // При «все типы» новый тип уже разрешён — явный список не нужен.
          if (type.kindIds !== null) {
            update.mutate({
              id: type.id,
              kindIds: kindIdsAfterToggle(type.kindIds, visible, kind.id, true),
            });
          }
          setNewName('');
          setCreating(false);
        },
      },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspacePageHeader
        title={ui.projects.schemasKinds}
        count={visible.length}
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
          <PanelNote>{ui.projects.schemasKindsSectionHint}</PanelNote>

          {allowed.length === 0 ? <PanelNote>{ui.projects.schemasKindsEmpty}</PanelNote> : null}

          {visible.length > 0 ? (
            <div className="flex min-w-0 flex-col">
              {visible.map((kind) => {
                const bound = allowedIds.includes(kind.id);
                const archived = kind.archivedAt !== null;
                return (
                  <div
                    key={kind.id}
                    className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/60"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenKind(kind.id)}
                      onDoubleClick={() => onOpenKind(kind.id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-0.5 text-left"
                      title={kind.name}
                    >
                      <NodeKindTile
                        icon={kind.icon}
                        color={kind.color}
                        className="size-9 rounded-lg"
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{kind.name}</span>
                          {archived ? (
                            <NodeChip tone="muted" className="shrink-0">
                              {ui.projects.schemasKindArchived}
                            </NodeChip>
                          ) : null}
                        </span>
                        <span
                          className="truncate text-xs text-muted-foreground"
                          title={kindRowSummary(kind)}
                        >
                          {kindRowSummary(kind)}
                        </span>
                      </span>
                    </button>
                    <Switch
                      checked={bound}
                      disabled={!canSetup}
                      aria-label={`${kind.name}: ${ui.projects.schemasKindAvailable}`}
                      onCheckedChange={(checked) => toggle(kind.id, checked)}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}

          {canSetup ? (
            creating ? (
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') createAndBind();
                    if (event.key === 'Escape') {
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                  placeholder={ui.nodeKinds.createPlaceholder}
                  aria-label={ui.projects.schemasCreateKind}
                  className="h-8 min-w-0 flex-1 text-sm"
                />
                <Button size="sm" disabled={!newName.trim()} onClick={createAndBind}>
                  {ui.common.create}
                </Button>
              </div>
            ) : (
              <PanelAction
                icon={Plus}
                onClick={() => {
                  setNewName('');
                  setCreating(true);
                }}
              >
                {ui.projects.schemasCreateKind}
              </PanelAction>
            )
          ) : null}

          {canSetup && explicit && allowed.length < visible.length ? (
            <PanelAction
              icon={RotateCcw}
              onClick={() => update.mutate({ id: type.id, kindIds: null })}
            >
              {ui.projects.schemasResetKinds}
            </PanelAction>
          ) : null}

          {canSetup && canManageWorkflows && boundWorks.length > 0 ? (
            <PanelAction icon={Check} onClick={allowBoundWorks}>
              {ui.projects.schemasSuggestWorks}
            </PanelAction>
          ) : null}
        </div>
      </div>
    </div>
  );
}
