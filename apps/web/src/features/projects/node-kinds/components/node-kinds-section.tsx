import { Check, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import type { NodeKind } from '@nodus/contracts';
import { NODE_KIND_CAPABILITIES, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { useArchiveNodeKind, useCreateNodeKind } from '../api/node-kinds-api.js';
import { NodeKindGlyph } from '../../structure/lib/node-kind-icon.js';
import { fieldsCountLabel, formSummary } from './node-kind-summary.js';

/**
 * Карточка «Виды папок» вкладки «Автоматизация → Типы проектов» (#556):
 * строки-виды с плиткой значка, чипами возможностей и счётчиком атрибутов;
 * клик открывает правую панель вида. Создание — тихая строка «+ Вид папки»
 * (имя; значок «Папка», цвет «Синий» — админ меняет в панели). Архивные —
 * зачёркнуты, возврат кнопкой. Без права `project.setup.manage` — список
 * без действий.
 */
export function NodeKindsSection({
  canSetup,
  selectedId,
  onSelect,
}: {
  canSetup: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const query = useNodeKinds();
  const create = useCreateNodeKind();
  const archive = useArchiveNodeKind();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const kinds: NodeKind[] = query.data ?? [];

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, icon: 'folder', color: 'blue' },
      {
        onSuccess: (kind) => {
          setName('');
          setCreating(false);
          onSelect(kind.id);
        },
      },
    );
  }

  return (
    <section className="node-panel flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <NodeLabel label={ui.nodeKinds.title} count={kinds.length} />
        {canSetup ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => setCreating((prev) => !prev)}
          >
            <Plus className="size-3" strokeWidth={1.75} />
            {ui.nodeKinds.create}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            }}
            placeholder={ui.nodeKinds.createPlaceholder}
            aria-label={ui.nodeKinds.create}
            className="h-8 min-w-0 flex-1 text-sm"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={ui.common.create}
            disabled={!name.trim()}
            onClick={submit}
          >
            <Check className="size-3.5" strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={ui.common.cancel}
            onClick={() => {
              setCreating(false);
              setName('');
            }}
          >
            <X className="size-3.5" strokeWidth={2} />
          </Button>
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : kinds.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">{ui.nodeKinds.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {kinds.map((kind) => {
            const archived = kind.archivedAt !== null;
            return (
              <li key={kind.id}>
                <div
                  className={cn(
                    'group flex h-9 items-center gap-2 rounded-md px-1.5 transition-colors',
                    selectedId === kind.id ? 'bg-accent/60' : 'hover:bg-accent/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(kind.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-pressed={selectedId === kind.id}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded border',
                        identityTone[kind.color].tile,
                      )}
                    >
                      <NodeKindGlyph icon={kind.icon} className="size-3.5" />
                    </span>
                    <span
                      className={cn(
                        'min-w-0 shrink truncate text-sm',
                        archived && 'text-muted-foreground line-through',
                      )}
                    >
                      {kind.name}
                    </span>
                    {!archived ? (
                      <span className="flex shrink-0 items-center gap-1">
                        {NODE_KIND_CAPABILITIES.filter((capability) =>
                          kind.capabilities.includes(capability),
                        ).map((capability) => (
                          <NodeChip key={capability} tone="muted">
                            {ui.nodeKinds.capabilityChip[capability]}
                          </NodeChip>
                        ))}
                      </span>
                    ) : null}
                  </button>
                  <span
                    className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                    title={formSummary(kind)}
                  >
                    {fieldsCountLabel(kind)}
                  </span>
                  {archived ? (
                    <>
                      <NodeChip tone="muted">{ui.projects.status.archived}</NodeChip>
                      {canSetup ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={ui.nodeKinds.panel.restore}
                          title={ui.nodeKinds.panel.restore}
                          onClick={() => archive.mutate({ id: kind.id, archived: false })}
                        >
                          <RotateCcw className="size-3.5" strokeWidth={1.75} />
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
