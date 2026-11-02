import { useNavigate, useSearch } from '@tanstack/react-router';
import { Settings2 } from 'lucide-react';
import { Permission, ui, type ProjectType } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { useNodeKinds } from '../../../shared/api/node-kinds.js';
import { useProjectGroups, useProjectTypes } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useCanManageFields } from '../../../shared/custom-fields/use-can-manage-fields.js';
import { openPortalSettings } from '../../../shared/projects/portal-settings-store.js';
import {
  useArchiveProjectGroup,
  useCreateProjectGroup,
  useCreateProjectType,
  useRenameProjectGroup,
  useSetProjectTypeArchived,
  useUpdateProjectType,
} from '../api/project-catalog-mutations.js';
import { CatalogSection } from '../components/project-catalog-section.js';
import { NodeKindPanel } from '../node-kinds/components/node-kind-panel.js';
import { NodeKindsSection } from '../node-kinds/components/node-kinds-section.js';
import type { RenderCreateField } from '../node-kinds/types.js';

/**
 * «Автоматизация → Типы проектов» (#52, #556): справочники модуля — типы
 * проектов (`project.setup.manage`), портфели (`project.create` /
 * `project.manage`) и виды папок структуры (#556). Справа — выезжающая
 * панель вида (`SidePanel`, общий кит): сужает зону сетки, как в
 * «Автоматизации». Глубокая ссылка — `?tab=project-types&kind=<id>`.
 * Архив — не удаление: проекты и папки сохраняют ссылку. Окно «Настройки
 * портала» — второй вход из шапки.
 */
export function ProjectTypesPage({
  renderCreateField,
}: {
  /** Слот «Создать атрибут…» (окно атрибута области «Папка») — заполняет
   *  `AutomationRoute` (композиция app, I6). */
  renderCreateField?: RenderCreateField;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { kind?: string };
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canManage = permissions.includes(Permission.PROJECT_MANAGE);
  const canCreateField = useCanManageFields();
  const kinds = useNodeKinds();
  const selected = kinds.data?.find((kind) => kind.id === search.kind) ?? null;

  const select = (id: string | null) =>
    void navigate({
      to: '/automation',
      search: (prev) => ({ ...prev, tab: 'project-types', kind: id ?? undefined }),
    });

  return (
    <div className="@container flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 px-6">
          <h1 className="text-xl font-semibold text-foreground">{ui.projects.typesTitle}</h1>
          {canSetup ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => openPortalSettings()}
            >
              <Settings2 className="size-3.5" strokeWidth={1.75} />
              {ui.projects.settingsTitle}
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-6 @min-[56rem]:grid-cols-2 @min-[78rem]:grid-cols-3">
            <TypesSection canSetup={canSetup} />
            <PortfoliosSection canManage={canManage} />
            <NodeKindsSection
              canSetup={canSetup}
              selectedId={selected?.id ?? null}
              onSelect={select}
            />
          </div>
        </div>
      </div>
      <NodeKindPanel
        kind={selected}
        canSetup={canSetup}
        canCreateField={canCreateField}
        onClose={() => select(null)}
        renderCreateField={renderCreateField}
      />
    </div>
  );
}

function TypesSection({ canSetup }: { canSetup: boolean }) {
  const { data, isLoading } = useProjectTypes(true);
  const create = useCreateProjectType();
  const update = useUpdateProjectType();
  const archive = useSetProjectTypeArchived();

  return (
    <CatalogSection
      title={ui.projects.typesTitle}
      empty={ui.projects.typesEmpty}
      createLabel={ui.projects.typesCreate}
      placeholder={ui.projects.typesNamePlaceholder}
      rows={data ?? []}
      loading={isLoading}
      canCreate={canSetup}
      canEdit={canSetup}
      canArchive={canSetup}
      canRestore={canSetup}
      archiveLabel={ui.projects.typesArchive}
      restoreLabel={ui.projects.typesRestore}
      onCreate={(name) => create.mutateAsync(name)}
      onRename={(id, name) => update.mutateAsync({ id, name })}
      onArchive={(id) => archive.mutate({ id, archived: true })}
      onRestore={(id) => archive.mutate({ id, archived: false })}
      rowExtra={(row) =>
        canSetup ? (
          <div className="flex items-center gap-1.5">
            <Select
              value={row.codeField}
              onValueChange={(value) =>
                update.mutate({ id: row.id, codeField: value as ProjectType['codeField'] })
              }
            >
              <SelectTrigger
                className="h-7 w-36 shrink-0 text-xs"
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
          </div>
        ) : null
      }
    />
  );
}

function PortfoliosSection({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useProjectGroups(true);
  const create = useCreateProjectGroup();
  const rename = useRenameProjectGroup();
  const archive = useArchiveProjectGroup();

  return (
    <CatalogSection
      title={ui.projects.portfoliosTitle}
      empty={ui.projects.portfolioEmpty}
      createLabel={ui.projects.portfolioCreate}
      placeholder={ui.projects.portfolioNamePlaceholder}
      rows={data ?? []}
      loading={isLoading}
      canCreate
      canEdit={canManage}
      canArchive={canManage}
      canRestore={false}
      archiveLabel={ui.projects.portfolioArchive}
      restoreLabel={ui.projects.typesRestore}
      onCreate={(name) => create.mutateAsync(name)}
      onRename={(id, name) => rename.mutateAsync({ id, name })}
      onArchive={(id) => archive.mutate(id)}
      onRestore={() => undefined}
    />
  );
}
