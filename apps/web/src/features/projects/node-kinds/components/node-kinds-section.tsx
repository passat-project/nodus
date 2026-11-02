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
import { useArchiveNodeKind, useCreateNodeKind } from '../api/node-kinds-api.js';
import { NodeKindTile } from '../../structure/lib/node-kind-icon.js';
import { fieldsCountShort, formSummary } from './node-kind-summary.js';

/**
 * Карточка «Виды папок» вкладки «Автоматизация → Типы проектов» (#556):
 * строки-виды с плиткой значка, названием, чипами возможностей и моно-
 * счётчиком атрибутов; клик открывает правую панель вида. Чипы — ВТОРОЙ
 * строкой под названием: колонка карточки ~370px, в одну строку три чипа
 * сжимали название до «К…» (замечание владельца). Создание — тихая строка
 * «+ Вид папки» в конце списка (модель ClickUp «Add group»), а не кнопка
 * шапки: она не спорит с заголовком за внимание. Архивные — зачёркнуты,
 * возврат строкой «Вернуть». Без права `project.setup.manage` — список без
 * действий.
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
      <NodeLabel label={ui.nodeKinds.title} count={kinds.length} />

      {query.isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : kinds.length === 0 && !creating ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">{ui.nodeKinds.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {kinds.map((kind) => {
            const archived = kind.archivedAt !== null;
            const chips = archived
              ? []
              : NODE_KIND_CAPABILITIES.filter((capability) =>
                  kind.capabilities.includes(capability),
                );
            return (
              <li key={kind.id}>
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors',
                    selectedId === kind.id ? 'bg-accent/60' : 'hover:bg-accent/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(kind.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-pressed={selectedId === kind.id}
                  >
                    <NodeKindTile icon={kind.icon} color={kind.color} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        className={cn(
                          'truncate text-sm',
                          archived && 'text-muted-foreground line-through',
                        )}
                      >
                        {kind.name}
                      </span>
                      {chips.length > 0 ? (
                        <span className="flex flex-wrap items-center gap-1">
                          {chips.map((capability) => (
                            <NodeChip key={capability} tone="muted">
                              {ui.nodeKinds.capabilityChip[capability]}
                            </NodeChip>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <span
                    className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                    title={formSummary(kind)}
                  >
                    {fieldsCountShort(kind)}
                  </span>
                  {archived && canSetup ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-muted-foreground"
                      title={ui.nodeKinds.panel.restore}
                      onClick={() => archive.mutate({ id: kind.id, archived: false })}
                    >
                      <RotateCcw className="size-3" strokeWidth={1.75} />
                      {ui.nodeKinds.restore}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}

          {canSetup ? (
            <li>
              {creating ? (
                <div className="flex items-center gap-1.5 px-1.5 py-1">
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
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                >
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
                    <Plus className="size-3.5" strokeWidth={1.75} />
                  </span>
                  {ui.nodeKinds.create}
                </button>
              )}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
