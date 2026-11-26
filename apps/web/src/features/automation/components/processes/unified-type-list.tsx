import { useMemo, useState, type ReactNode } from 'react';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Archive, Search, X } from 'lucide-react';

import { useArchiveProcessType } from '../../api/automation-api.js';
import { ProcessTypeCreateDialog } from '../types/type-create-dialog.js';
import { KindRow, NoProjectRow, ProcessTypeRow, ProjectTypeRow } from './unified-type-rows.js';
import { UnifiedGroupEmpty, UnifiedGroupHeader } from './unified-type-row.js';

/**
 * Левая колонка единого входа «Процессы» (#857, единая модель §5): четыре
 * группы в строгом порядке — Проекты (последней строкой «Без проекта»),
 * Задачи, Письма, Папки. Группы сворачиваются, поиск один на все (фильтрует
 * по имени, раскрывает группу с найденным, прячет пустые), «+» в заголовке
 * создаёт тип категории (в т.ч. копией; у «Писем» создания нет — каталог
 * заморожен, #55). Архив — свёрнутой группой внизу, все категории вместе.
 * Проектные группы скрыты без права `project.setup.manage`; строки —
 * `unified-type-rows.tsx`.
 */
export interface UnifiedTypeListProps {
  processTypes: ProcessType[];
  projectTypes: ProjectType[];
  kinds: NodeKind[];
  canSetup: boolean;
  canManage: boolean;
  isLoading: boolean;
  dirtyIds: ReadonlySet<string>;
  selectedProcessTypeId?: string;
  selectedProjectTypeId?: string;
  selectedKindId?: string;
  noProjectSelected: boolean;
  onSelectProcessType: (id: string) => void;
  onOpenProcessTypeSettings: (id: string) => void;
  onSelectProjectType: (id: string) => void;
  onOpenProjectSettings: (id: string) => void;
  onSelectNoProject: () => void;
  onSelectKind: (id: string) => void;
  onArchiveProject: (id: string, archived: boolean) => void;
  onArchiveNodeKind: (id: string, archived: boolean) => void;
  /** Окно создания типа проекта — слот фичи projects (I6). */
  renderProjectTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
  /** Окно создания типа папки — слот фичи projects (I6). */
  renderKindCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
}

export function UnifiedTypeList(props: UnifiedTypeListProps) {
  const { processTypes, projectTypes, kinds, canSetup, canManage } = props;
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [projectCreate, setProjectCreate] = useState<{ baseId?: string } | null>(null);
  const [kindCreate, setKindCreate] = useState<{ baseId?: string } | null>(null);
  const archiveType = useArchiveProcessType(true);
  const restoreType = useArchiveProcessType(false);

  const q = query.trim().toLowerCase();
  const isOpen = (id: string) => (q ? true : !collapsed[id]);
  const toggle = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const aliveProjects = useMemo(
    () =>
      projectTypes.filter(
        (type) => type.archivedAt === null && (!q || type.name.toLowerCase().includes(q)),
      ),
    [projectTypes, q],
  );
  const archivedProjects = useMemo(
    () =>
      projectTypes.filter(
        (type) => type.archivedAt !== null && (!q || type.name.toLowerCase().includes(q)),
      ),
    [projectTypes, q],
  );
  const aliveTasks = useMemo(
    () =>
      processTypes.filter(
        (t) => t.category === 'task' && !t.archivedAt && (!q || t.name.toLowerCase().includes(q)),
      ),
    [processTypes, q],
  );
  const aliveLetters = useMemo(
    () =>
      processTypes.filter(
        (t) => t.category === 'letter' && !t.archivedAt && (!q || t.name.toLowerCase().includes(q)),
      ),
    [processTypes, q],
  );
  const archivedProcess = useMemo(
    () =>
      processTypes.filter((t) => t.archivedAt !== null && (!q || t.name.toLowerCase().includes(q))),
    [processTypes, q],
  );
  const aliveKinds = useMemo(
    () =>
      kinds.filter(
        (kind) => kind.archivedAt === null && (!q || kind.name.toLowerCase().includes(q)),
      ),
    [kinds, q],
  );
  const archivedKinds = useMemo(
    () =>
      kinds.filter(
        (kind) => kind.archivedAt !== null && (!q || kind.name.toLowerCase().includes(q)),
      ),
    [kinds, q],
  );
  const metaProjects = useMemo(
    () => projectTypes.filter((type) => type.archivedAt === null),
    [projectTypes],
  );

  const processRow = (type: ProcessType): ReactNode => (
    <ProcessTypeRow
      key={type.id}
      type={type}
      selected={props.selectedProcessTypeId === type.id}
      dirty={props.dirtyIds.has(type.id)}
      canManage={canManage}
      metaProjects={metaProjects}
      onSelect={() => props.onSelectProcessType(type.id)}
      onOpenSettings={() => props.onOpenProcessTypeSettings(type.id)}
      onCopy={() => setTaskCreateOpen(true)}
      onArchive={() => archiveType.mutate(type.id)}
      onRestore={() => restoreType.mutate(type.id)}
    />
  );

  const projectRow = (type: ProjectType): ReactNode => (
    <ProjectTypeRow
      key={type.id}
      type={type}
      selected={props.selectedProjectTypeId === type.id}
      canSetup={canSetup}
      kinds={kinds}
      onSelect={() => props.onSelectProjectType(type.id)}
      onOpenSettings={() => props.onOpenProjectSettings(type.id)}
      onCopy={() => setProjectCreate({ baseId: type.id })}
      onArchive={() => props.onArchiveProject(type.id, true)}
      onRestore={() => props.onArchiveProject(type.id, false)}
    />
  );

  const kindRow = (kind: NodeKind): ReactNode => (
    <KindRow
      key={kind.id}
      kind={kind}
      selected={props.selectedKindId === kind.id}
      canSetup={canSetup}
      onSelect={() => props.onSelectKind(kind.id)}
      onCopy={() => setKindCreate({ baseId: kind.id })}
      onArchive={() => props.onArchiveNodeKind(kind.id, true)}
      onRestore={() => props.onArchiveNodeKind(kind.id, false)}
    />
  );

  const groups: {
    id: string;
    label: string;
    rows: ReactNode[];
    onCreate?: () => void;
    createLabel?: string;
  }[] = [
    ...(canSetup
      ? [
          {
            id: 'project',
            label: ui.automation.entry.groups.project,
            rows: [
              ...aliveProjects.map(projectRow),
              <NoProjectRow
                key="__no_project__"
                selected={props.noProjectSelected}
                onSelect={props.onSelectNoProject}
              />,
            ],
            onCreate: () => setProjectCreate({}),
            createLabel: ui.projects.typesCreate,
          },
        ]
      : []),
    {
      id: 'task',
      label: ui.automation.entry.groups.task,
      rows: aliveTasks.map(processRow),
      ...(canManage
        ? { onCreate: () => setTaskCreateOpen(true), createLabel: ui.automation.newType }
        : {}),
    },
    { id: 'letter', label: ui.automation.entry.groups.letter, rows: aliveLetters.map(processRow) },
    ...(canSetup
      ? [
          {
            id: 'folder',
            label: ui.automation.entry.groups.folder,
            rows: aliveKinds.map(kindRow),
            onCreate: () => setKindCreate({}),
            createLabel: ui.projects.schemasCreateKind,
          },
        ]
      : []),
  ];

  const archivedRows = [
    ...(canSetup ? archivedProjects.map(projectRow) : []),
    ...archivedProcess.map(processRow),
    ...(canSetup ? archivedKinds.map(kindRow) : []),
  ];

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui.common.search}
            aria-label={ui.common.search}
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5">
        {props.isLoading ? (
          <div className="px-2 py-2 text-sm text-muted-foreground">{ui.common.loading}</div>
        ) : (
          groups.map((group) => {
            // Поиск прячет группы без найденного.
            if (q && group.rows.length === 0) return null;
            const open = isOpen(group.id);
            return (
              <div key={group.id} className="flex flex-col gap-0.5">
                <UnifiedGroupHeader
                  label={group.label}
                  count={group.rows.length}
                  collapsed={!open}
                  onToggle={() => toggle(group.id)}
                  onCreate={group.onCreate}
                  createLabel={group.createLabel}
                />
                {open ? group.rows.length > 0 ? group.rows : <UnifiedGroupEmpty /> : null}
              </div>
            );
          })
        )}
        {archivedRows.length > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setArchiveOpen((value) => !value)}
              aria-expanded={archiveOpen}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <Archive className="size-3.5" strokeWidth={1.75} />
              {ui.automation.archiveGroup} · {archivedRows.length}
            </button>
            {archiveOpen ? archivedRows : null}
          </div>
        ) : null}
      </div>

      {taskCreateOpen ? <ProcessTypeCreateDialog onClose={() => setTaskCreateOpen(false)} /> : null}
      {projectCreate && props.renderProjectTypeCreate
        ? props.renderProjectTypeCreate({
            baseId: projectCreate.baseId,
            onClose: () => setProjectCreate(null),
            onCreated: (id) => props.onSelectProjectType(id),
          })
        : null}
      {kindCreate && props.renderKindCreate
        ? props.renderKindCreate({
            baseId: kindCreate.baseId,
            onClose: () => setKindCreate(null),
            onCreated: (id) => props.onSelectKind(id),
          })
        : null}
    </aside>
  );
}
