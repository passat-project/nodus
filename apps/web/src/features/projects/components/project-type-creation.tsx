import { useState } from 'react';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { typeConfigOf, ui, withProjectTypeAllowed } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../shared/workflow/type-tone.js';
import { WorkspacePageHeader } from './workspace-page-header.js';

/**
 * Страница «Что здесь можно создавать» (#665, ADR-0041 п.9; страница
 * рабочей области типа — #857): одна связь «тип процесса × место
 * создания», сторона типа проекта. По умолчанию разрешено всё (посев не
 * ломает поведение); тумблер снимает тип в этом типе проекта. Пишется в
 * настройку САМОГО типа процесса — вторая сторона («Где создаётся»)
 * показывает то же самое, копии настройки нет. Клик по строке открывает
 * настройку этого типа (дорожка вернётся сюда).
 */
export function ProjectTypeCreationPage({
  type,
  canSetup,
  onBack,
  onOpenType,
}: {
  type: ProjectType;
  canSetup: boolean;
  onBack: () => void;
  onOpenType: (id: string) => void;
}) {
  const tasks = useLiveProcessTypes('task');
  const letters = useLiveProcessTypes('letter');
  const update = useUpdateTypeCreation();
  const [query, setQuery] = useState('');
  // Запись связи требует `workflow.manage` (сервер — истина, I8): у настройщика
  // типов проектов без права процессов тумблеры неактивны, а не дают 403.
  const canManage = useCanManageWorkflows();
  const canSave = canSetup && canManage;

  function toggle(item: ProcessType, allowed: boolean): void {
    const scope = typeConfigOf(item).creation;
    // Снятие работы, привязанной к включённому типу папки, — предупреждение:
    // её нельзя будет создать даже в папке (issue #665).
    const boundHere =
      !allowed &&
      scope.folderKindId !== null &&
      (type.kindIds === null || type.kindIds.includes(scope.folderKindId));
    if (boundHere) toast.warning(ui.automation.creationScope.unbindWarning);
    update.mutate({ typeId: item.id, creation: withProjectTypeAllowed(scope, type.id, allowed) });
  }

  const q = query.trim().toLowerCase();
  const group = (title: string, items: readonly ProcessType[] | undefined) => {
    const rows = (items ?? []).filter((item) => !q || item.name.toLowerCase().includes(q));
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <NodeLabel label={title} count={rows.length} className="px-1 pb-1" />
        {rows.length === 0 ? (
          <PanelNote>{ui.automation.creationScope.empty}</PanelNote>
        ) : (
          rows.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/60"
            >
              <button
                type="button"
                onClick={() => onOpenType(item.id)}
                onDoubleClick={() => onOpenType(item.id)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                title={item.name}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg border',
                    typeToneOf(item.color),
                  )}
                >
                  <ProcessTypeGlyph icon={item.icon} className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{item.name}</span>
                  {item.description ? (
                    <span
                      className="truncate text-xs text-muted-foreground"
                      title={item.description}
                    >
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </button>
              <Switch
                checked={!typeConfigOf(item).creation.excludedProjectTypeIds.includes(type.id)}
                disabled={!canSave || update.isPending}
                aria-label={`${item.name}: ${ui.automation.creationScope.projectSectionTitle}`}
                onCheckedChange={(checked) => toggle(item, checked)}
              />
            </div>
          ))
        )}
      </div>
    );
  };

  const total = (tasks.data?.length ?? 0) + (letters.data?.length ?? 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspacePageHeader
        title={ui.projects.schemasCreationPage}
        count={total}
        onBack={onBack}
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui.common.search}
            aria-label={ui.common.search}
            className="h-8 w-44 text-sm"
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
          {canSetup && !canSave ? (
            <PanelNote>{ui.automation.creationScope.noWorkflowPermission}</PanelNote>
          ) : null}
          {group(ui.automation.creationScope.tasksGroup, tasks.data)}
          {group(ui.automation.creationScope.lettersGroup, letters.data)}
        </div>
      </div>
    </div>
  );
}
