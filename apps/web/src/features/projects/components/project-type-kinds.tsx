import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import { allowedNodeKinds, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';

import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { useCreateNodeKind } from '../node-kinds/api/node-kinds-api.js';
import { fieldsCountLabel } from '../node-kinds/components/node-kind-summary.js';
import { NodeKindTile } from '../structure/lib/node-kind-icon.js';

/**
 * Рабочая зона типа в «Схемах проектов» (#556): раздел «Виды папок» —
 * какие виды справочника доступны папкам проектов этого типа. `null` в
 * `kindIds` — «все виды»; снятие вида делает список явным, возврат к полному
 * набору снова пишет `null`. Клик по виду открывает правую панель настройки
 * вида (форма, возможности). Снятый вид не ломает уже созданные папки.
 */
export function ProjectTypeKinds({
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
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const alive = kinds.filter((kind) => kind.archivedAt === null || type.kindIds?.includes(kind.id));
  const allowed = allowedNodeKinds(type.kindIds, alive);
  const allowedIds = allowed.map((kind) => kind.id);
  const unbound = alive.filter((kind) => !allowedIds.includes(kind.id));
  const allBound = allowedIds.length === alive.length;

  function saveKindIds(next: string[]) {
    const normalized = next.length === alive.length ? null : next;
    update.mutate({ id: type.id, kindIds: normalized });
  }

  function unbind(kindId: string) {
    saveKindIds(allowedIds.filter((id) => id !== kindId));
  }

  function bind(kindId: string) {
    saveKindIds([...allowedIds, kindId]);
  }

  function createAndBind() {
    const name = newName.trim();
    if (!name) return;
    createKind.mutate(
      { name, icon: 'folder', color: 'blue' },
      {
        onSuccess: (kind) => {
          setNewName('');
          setAdding(false);
          saveKindIds([...allowedIds, kind.id]);
        },
      },
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <NodeLabel label={ui.projects.schemasKinds} count={allowed.length} />
          <p className="text-xs break-words text-muted-foreground">
            {ui.projects.schemasKindsSectionHint}
          </p>
        </div>
        {allBound ? <NodeChip tone="muted">{ui.projects.schemasKindsAll}</NodeChip> : null}
      </div>

      {allowed.length === 0 ? (
        <p className="rounded-lg bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
          {ui.projects.schemasKindsEmpty}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {allowed.map((kind) => (
            <li key={kind.id}>
              <div className="group flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/40">
                <button
                  type="button"
                  onClick={() => onOpenKind(kind.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <NodeKindTile icon={kind.icon} color={kind.color} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{kind.name}</span>
                    {kind.capabilities.length > 0 ? (
                      <span className="flex items-center gap-1">
                        {kind.capabilities.map((capability) => (
                          <NodeChip key={capability} tone="muted">
                            {ui.nodeKinds.capabilityChip[capability]}
                          </NodeChip>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {fieldsCountLabel(kind)}
                  </span>
                </button>
                {canSetup ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={ui.projects.schemasUnbindKind}
                    title={ui.projects.schemasUnbindKind}
                    className="shrink-0 text-muted-foreground"
                    onClick={() => unbind(kind.id)}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canSetup ? (
        <Popover
          open={adding}
          onOpenChange={(next) => {
            setAdding(next);
            if (!next) setNewName('');
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 self-start text-muted-foreground"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              {ui.projects.schemasAddKind}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-72 flex-col gap-1 p-1.5">
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {unbound.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  {ui.projects.schemasKindPickerEmpty}
                </p>
              ) : (
                unbound.map((kind) => (
                  <button
                    key={kind.id}
                    type="button"
                    onClick={() => {
                      bind(kind.id);
                      setAdding(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60"
                  >
                    <NodeKindTile icon={kind.icon} color={kind.color} />
                    <span className="min-w-0 flex-1 truncate">{kind.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {fieldsCountLabel(kind)}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="flex items-center gap-1.5">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createAndBind();
                }}
                placeholder={ui.projects.schemasCreateKind}
                aria-label={ui.projects.schemasCreateKind}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
              />
              <Button size="sm" disabled={!newName.trim()} onClick={createAndBind}>
                {ui.common.create}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </section>
  );
}
