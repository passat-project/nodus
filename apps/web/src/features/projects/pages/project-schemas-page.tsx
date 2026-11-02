import { useNavigate, useSearch } from '@tanstack/react-router';
import { Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useNodeKinds } from '../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useCanManageFields } from '../../../shared/custom-fields/use-can-manage-fields.js';
import { Permission } from '@nodus/contracts';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { identityTone } from '../../../shared/ui/identity-tone.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { ProjectTypeColumn } from '../components/project-type-column.js';
import { ProjectTypeKinds } from '../components/project-type-kinds.js';
import { ProjectTypePanel } from '../components/project-type-panel.js';
import { NodeKindPanel } from '../node-kinds/components/node-kind-panel.js';
import type { RenderCreateField } from '../node-kinds/types.js';

/**
 * «Автоматизация → Схемы проектов» (#556 — каркас, #38 — схема/форма/доступ):
 * окно-сплит как «Процессы». Слева — типы проектов, справа — рабочая зона
 * выбранного типа; сейчас в ней раздел «Виды папок»: какие виды доступны
 * папкам этого типа и их настройка (правая панель вида — форма, возможности).
 * Портфели сюда не входят: они группируют список проектов и живут в модуле
 * «Проекты» (#559). Глубокие ссылки: `?tab=project-schemas&type=&kind=`.
 */
export function ProjectSchemasPage({
  renderCreateField,
}: {
  /** Слот «Создать атрибут…» панели вида — заполняет `AutomationRoute` (I6). */
  renderCreateField?: RenderCreateField;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { type?: string; kind?: string };
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canCreateField = useCanManageFields();
  const typesQuery = useProjectTypes(true);
  const kindsQuery = useNodeKinds();
  // Две панели справа — типа и вида: открыта не больше одной.
  const [panel, setPanel] = useState<'type' | 'kind' | null>(null);

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const alive = useMemo(() => types.filter((type) => type.archivedAt === null), [types]);
  const selectedType = useMemo(
    () => types.find((type) => type.id === search.type) ?? alive[0] ?? null,
    [types, alive, search.type],
  );
  const selectedKind = kinds.find((kind) => kind.id === search.kind) ?? null;

  const selectType = (id: string) =>
    void navigate({
      to: '/automation',
      search: (prev) => ({ ...prev, tab: 'project-schemas', type: id, kind: undefined }),
    });
  const selectKind = (id: string | null) => {
    setPanel(id ? 'kind' : null);
    void navigate({
      to: '/automation',
      search: (prev) => ({ ...prev, tab: 'project-schemas', kind: id ?? undefined }),
    });
  };

  return (
    <div className="@container flex h-full">
      <ProjectTypeColumn
        types={types}
        isLoading={typesQuery.isLoading}
        selectedId={selectedType?.id ?? null}
        onSelect={selectType}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedType ? (
          <TypeWorkspace
            type={selectedType}
            kinds={kinds}
            canSetup={canSetup}
            onOpenKind={selectKind}
            onOpenSettings={() => setPanel('type')}
          />
        ) : typesQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-9 w-full max-w-xl" />
            <Skeleton className="h-9 w-full max-w-lg" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            {ui.projects.typesEmpty}
          </div>
        )}
      </div>
      <ProjectTypePanel
        type={selectedType}
        open={panel === 'type'}
        canSetup={canSetup}
        onClose={() => setPanel(null)}
      />
      <NodeKindPanel
        kind={panel === 'kind' ? selectedKind : null}
        canSetup={canSetup}
        canCreateField={canCreateField}
        onClose={() => selectKind(null)}
        renderCreateField={renderCreateField}
      />
    </div>
  );
}

/** Шапка типа (имя, политика шифра, архив) + раздел «Виды папок». */
function TypeWorkspace({
  type,
  kinds,
  canSetup,
  onOpenKind,
  onOpenSettings,
}: {
  type: ProjectType;
  kinds: Parameters<typeof ProjectTypeKinds>[0]['kinds'];
  canSetup: boolean;
  onOpenKind: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const update = useUpdateProjectType();
  const archived = type.archivedAt !== null;

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span
          aria-hidden
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded border',
            identityTone[type.color].tile,
          )}
        >
          <ProcessTypeGlyph icon={type.icon} className="size-4" />
        </span>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground">
          {type.name}
        </h1>
        {canSetup ? (
          <Select
            value={type.codeField}
            onValueChange={(value) =>
              update.mutate({ id: type.id, codeField: value as ProjectType['codeField'] })
            }
          >
            <SelectTrigger
              className="h-8 w-40 shrink-0 text-xs"
              aria-label={ui.projects.codeFieldLabel}
              title={ui.projects.codeFieldLabel}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              {(['hidden', 'optional', 'required'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {ui.projects.codeField[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {canSetup ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={ui.projects.schemasTypes}
            title={ui.projects.schemasTypes}
            onClick={onOpenSettings}
          >
            <Settings2 className="size-4" strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {archived ? (
            <p className="rounded-lg bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
              {ui.projects.status.archived}
            </p>
          ) : null}
          <ProjectTypeKinds type={type} kinds={kinds} canSetup={canSetup} onOpenKind={onOpenKind} />
        </div>
      </div>
    </>
  );
}
