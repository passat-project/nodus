import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { useCreateProjectType } from '../api/project-catalog-mutations.js';

/**
 * Левая колонка «Схем проектов» (#556, каркас #38): типы проектов —
 * грамматика списка «Процессов» (шапка h-14 с поиском и «+», строки
 * «название + политика шифра»), архивные — свёрнутой группой внизу.
 * Название раздела не дублируется — вкладка в топбаре.
 */
export function ProjectTypeColumn({
  types,
  isLoading,
  selectedId,
  onSelect,
}: {
  types: ProjectType[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const create = useCreateProjectType();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const alive = useMemo(() => types.filter((type) => type.archivedAt === null), [types]);
  const archived = useMemo(() => types.filter((type) => type.archivedAt !== null), [types]);
  const q = query.trim().toLowerCase();
  const shown = q ? alive.filter((type) => type.name.toLowerCase().includes(q)) : alive;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(trimmed, {
      onSuccess: (type) => {
        setName('');
        setCreating(false);
        onSelect(type.id);
      },
    });
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui.projects.schemasTypesSearch}
            aria-label={ui.projects.schemasTypesSearch}
            className="h-8 pl-7 text-sm"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={ui.projects.typesCreate}
          title={ui.projects.typesCreate}
          onClick={() => setCreating((prev) => !prev)}
        >
          <Plus className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

      {creating ? (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') setCreating(false);
            }}
            placeholder={ui.projects.typesNamePlaceholder}
            aria-label={ui.projects.typesCreate}
            className="h-8 min-w-0 flex-1 text-sm"
          />
          <Button size="sm" disabled={!name.trim()} onClick={submit}>
            {ui.common.create}
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex flex-col gap-1.5 p-1">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{ui.projects.typesEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((type) => (
              <li key={type.id}>
                <button
                  type="button"
                  onClick={() => onSelect(type.id)}
                  aria-pressed={selectedId === type.id}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    selectedId === type.id ? 'bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded border',
                      identityTone[type.color].tile,
                    )}
                  >
                    <ProcessTypeGlyph icon={type.icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{type.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ui.projects.codeField[type.codeField]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 ? (
          <div className="mt-3 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setShowArchived((prev) => !prev)}
              aria-expanded={showArchived}
              className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <span>{ui.projects.status.archived}</span>
              <span className="font-mono tabular-nums">{archived.length}</span>
            </button>
            {showArchived ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {archived.map((type) => (
                  <li key={type.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(type.id)}
                      className={cn(
                        'flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground line-through transition-colors',
                        selectedId === type.id ? 'bg-accent/60' : 'hover:bg-accent/40',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{type.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
