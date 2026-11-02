import { useMemo, useState } from 'react';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';
import { Archive, ArchiveRestore, MoreHorizontal, Plus, Search, Settings2, X } from 'lucide-react';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { useSetProjectTypeArchived } from '../api/project-catalog-mutations.js';
import { typeMeta } from '../lib/project-type-summary.js';
import { ProjectTypeCreateDialog } from './project-type-create-dialog.js';

/**
 * Левая колонка «Схем проектов» (#556, каркас #38) — грамматика списка
 * «Процессов»: шапка h-14 с поиском и «+», строки «плитка-значок + название
 * + мета», меню «⋯» по ховеру (настройки типа / архив), архивные — свёрнутой
 * группой внизу. Клик по строке выбирает тип: справа его канвас, настройки —
 * командой «⋯ → Настройки типа». Название раздела не дублируется (вкладка в
 * топбаре).
 */
export function ProjectTypeColumn({
  types,
  kinds,
  isLoading,
  selectedId,
  canSetup,
  onSelect,
  onOpenSettings,
}: {
  types: ProjectType[];
  kinds: NodeKind[];
  isLoading: boolean;
  selectedId: string | null;
  /** Право `project.setup.manage` — создание, настройки, архив. */
  canSetup: boolean;
  onSelect: (id: string) => void;
  onOpenSettings: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archive = useSetProjectTypeArchived();

  const q = query.trim().toLowerCase();
  const alive = useMemo(
    () =>
      types.filter(
        (type) => type.archivedAt === null && (!q || type.name.toLowerCase().includes(q)),
      ),
    [types, q],
  );
  const archived = useMemo(
    () =>
      types.filter(
        (type) => type.archivedAt !== null && (!q || type.name.toLowerCase().includes(q)),
      ),
    [types, q],
  );

  const row = (type: ProjectType) => {
    const selected = type.id === selectedId;
    const rowArchived = type.archivedAt !== null;
    return (
      <div key={type.id} className="group/row relative">
        <button
          type="button"
          onClick={() => !rowArchived && onSelect(type.id)}
          aria-current={selected || undefined}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors',
            !rowArchived && 'cursor-pointer',
            selected ? 'bg-accent' : !rowArchived && 'hover:bg-accent/40',
            rowArchived && 'text-muted-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg border',
              identityTone[type.color].tile,
            )}
          >
            <ProcessTypeGlyph icon={type.icon} className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{type.name}</span>
            <span className="mt-0.5 block truncate text-label-sm text-muted-foreground">
              {typeMeta(type, kinds)}
            </span>
          </span>
        </button>
        {canSetup ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={ui.common.rowMenu}
              className={cn(
                'absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100',
                selected && 'opacity-100',
              )}
            >
              <MoreHorizontal className="size-4" strokeWidth={1.75} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {!rowArchived ? (
                <>
                  <DropdownMenuItem onSelect={() => onOpenSettings(type.id)}>
                    <Settings2 className="size-3.5" />
                    {ui.projects.schemasTypeSettings}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                onSelect={() => archive.mutate({ id: type.id, archived: !rowArchived })}
              >
                {rowArchived ? (
                  <ArchiveRestore className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                {rowArchived ? ui.projects.typesRestore : ui.projects.typesArchive}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui.projects.schemasTypesSearch}
            aria-label={ui.projects.schemasTypesSearch}
            className="h-8 pr-7 pl-8 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={ui.filters.reset}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        {canSetup ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label={ui.projects.typesCreate}
            title={ui.projects.typesCreate}
            className="ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {isLoading ? (
          <div className="flex flex-col gap-1.5 p-1">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : alive.length > 0 ? (
          alive.map(row)
        ) : (
          <div className="px-2 py-2 text-sm text-muted-foreground">{ui.projects.typesEmpty}</div>
        )}
        {archived.length > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setArchiveOpen((value) => !value)}
              aria-expanded={archiveOpen}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <Archive className="size-3.5" strokeWidth={1.75} />
              {ui.projects.status.archived} · {archived.length}
            </button>
            {archiveOpen ? archived.map(row) : null}
          </div>
        ) : null}
      </div>

      {createOpen ? (
        <ProjectTypeCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => onSelect(id)}
        />
      ) : null}
    </aside>
  );
}
