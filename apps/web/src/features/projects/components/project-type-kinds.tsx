import { useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import { allowedNodeKinds, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Switch } from '@nodus/ui/components/switch';

import { PanelAction, PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { kindIdsAfterToggle, visibleTypeKinds } from '../lib/project-type-summary.js';
import { useCreateNodeKind } from '../node-kinds/api/node-kinds-api.js';
import { kindRowSummary } from '../node-kinds/components/node-kind-summary.js';
import { NodeKindTile } from '../structure/lib/node-kind-icon.js';

/**
 * Раздел «Виды папок» настроек типа (#556) — какие виды справочника доступны
 * папкам проектов этого типа. `null` в `kindIds` — все виды; снятие вида
 * делает список явным, возврат к полному набору снова пишет `null`. Снятый
 * вид не ломает уже созданные папки. Клик по строке открывает панель вида
 * (форма, возможности) поверх этой; тумблер — только доступность типу.
 */
export function ProjectTypeKindsSection({
  type,
  kinds,
  canSetup,
  onOpenKind,
}: {
  type: ProjectType;
  kinds: NodeKind[];
  canSetup: boolean;
  onOpenKind: (id: string) => void;
}) {
  const update = useUpdateProjectType();
  const createKind = useCreateNodeKind();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const visible = visibleTypeKinds(type, kinds);
  const allowed = allowedNodeKinds(type.kindIds, visible);
  const allowedIds = allowed.map((kind) => kind.id);
  const explicit = type.kindIds !== null;

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
          // При «все виды» новый вид уже разрешён — явный список не нужен.
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
    <>
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
                className="group/kind -mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
              >
                <button
                  type="button"
                  onClick={() => onOpenKind(kind.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5 text-left"
                >
                  <NodeKindTile icon={kind.icon} color={kind.color} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm">{kind.name}</span>
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
        <PanelAction icon={RotateCcw} onClick={() => update.mutate({ id: type.id, kindIds: null })}>
          {ui.projects.schemasResetKinds}
        </PanelAction>
      ) : null}
    </>
  );
}
