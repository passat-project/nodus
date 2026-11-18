import type { ProcessType } from '@nodus/contracts';
import { typeConfigOf, ui, withProjectTypeAllowed } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';
import { RotateCcw } from 'lucide-react';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { PanelAction, PanelField, PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';

/**
 * «Где создаётся» (#665, ADR-0041 п.9) — сторона типа процесса: список
 * «Проекты» (типы проектов + «Без проекта» одной колонкой галочек) и вид
 * папки, в котором задачу можно создать. Связь одна: в типе проекта та же
 * настройка показана как «Что можно создавать».
 */
export function TypeCreationScopeSection({
  type,
  canSave,
}: {
  type: ProcessType;
  canSave: boolean;
}) {
  const projectTypes = useProjectTypes();
  const kinds = useNodeKinds();
  const update = useUpdateTypeCreation();
  const scope = typeConfigOf(type).creation;
  const isTask = type.category === 'task';

  function save(patch: Partial<typeof scope>): void {
    update.mutate({ typeId: type.id, creation: { ...scope, ...patch } });
  }

  function toggle(projectTypeId: string, allowed: boolean): void {
    const next = withProjectTypeAllowed(scope, projectTypeId, allowed);
    save({ excludedProjectTypeIds: next.excludedProjectTypeIds });
  }

  const liveTypes = (projectTypes.data ?? []).filter((item) => item.archivedAt === null);
  const liveKinds = (kinds.data ?? []).filter((kind) => kind.archivedAt === null);

  return (
    <>
      <PanelField label={ui.automation.creationScope.projectTypeRow}>
        <div className="flex min-w-0 flex-col">
          {liveTypes.length === 0 ? (
            <PanelNote>{ui.automation.creationScope.projectTypesEmpty}</PanelNote>
          ) : (
            liveTypes.map((projectType) => (
              <div
                key={projectType.id}
                className="-mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded border',
                    identityTone[projectType.color].tile,
                  )}
                >
                  <ProcessTypeGlyph icon={projectType.icon} className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{projectType.name}</span>
                <Switch
                  checked={!scope.excludedProjectTypeIds.includes(projectType.id)}
                  disabled={!canSave || update.isPending}
                  aria-label={`${projectType.name}: ${ui.automation.creationScope.sectionTitle}`}
                  onCheckedChange={(checked) => toggle(projectType.id, checked)}
                />
              </div>
            ))
          )}

          {/* «Без проекта» — такая же строка списка мест, не отдельная
              настройка: имя выровнено с названиями типов (плитка 24 + gap). */}
          {isTask ? (
            <div className="-mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
              <span
                className={cn('min-w-0 flex-1 truncate text-sm', liveTypes.length > 0 && 'pl-8')}
              >
                {ui.automation.creationScope.withoutProject}
              </span>
              <Switch
                checked={scope.withoutProject}
                disabled={!canSave || update.isPending}
                aria-label={ui.automation.creationScope.withoutProject}
                onCheckedChange={(checked) => save({ withoutProject: checked })}
              />
            </div>
          ) : null}
        </div>
      </PanelField>

      {isTask ? (
        <PanelField label={ui.automation.creationScope.folderKind}>
          <Select
            value={scope.folderKindId ?? 'any'}
            disabled={!canSave || update.isPending}
            onValueChange={(value) => save({ folderKindId: value === 'any' ? null : value })}
          >
            <SelectTrigger
              className="h-8 w-full text-sm"
              aria-label={ui.automation.creationScope.folderKind}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              <SelectItem value="any">{ui.automation.creationScope.folderKindAny}</SelectItem>
              {liveKinds.map((kind) => (
                <SelectItem key={kind.id} value={kind.id}>
                  {kind.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelField>
      ) : null}

      {scope.excludedProjectTypeIds.length > 0 ? (
        <PanelAction icon={RotateCcw} onClick={() => save({ excludedProjectTypeIds: [] })}>
          {ui.automation.creationScope.allowAll}
        </PanelAction>
      ) : null}
    </>
  );
}
