import type { ProcessType, ProjectType } from '@nodus/contracts';
import { typeConfigOf, ui, withProjectTypeAllowed } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../shared/workflow/type-tone.js';

/**
 * «Что можно создавать» (#665, ADR-0041 п.9) — сторона типа проекта у одной
 * связи «тип процесса × место создания». По умолчанию разрешено всё (посев
 * не ломает поведение); тумблер снимает тип в этом типе проекта. Пишется в
 * настройку САМОГО типа процесса — вторая сторона («Где создаётся»)
 * показывает то же самое, копии настройки нет. Строки — та же грамматика,
 * что у «Видов папок» (плитка 24, название и сводка, тумблер).
 */
export function ProjectTypeCreationSection({
  type,
  canSetup,
}: {
  type: ProjectType;
  canSetup: boolean;
}) {
  const tasks = useLiveProcessTypes('task');
  const letters = useLiveProcessTypes('letter');
  const update = useUpdateTypeCreation();

  function toggle(item: ProcessType, allowed: boolean): void {
    const scope = typeConfigOf(item).creation;
    update.mutate({ typeId: item.id, creation: withProjectTypeAllowed(scope, type.id, allowed) });
  }

  const group = (title: string, items: readonly ProcessType[] | undefined) => {
    const rows = items ?? [];
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <NodeLabel label={title} className="px-2 pb-1" />
        {rows.length === 0 ? (
          <PanelNote>{ui.automation.creationScope.empty}</PanelNote>
        ) : (
          rows.map((item) => (
            <div
              key={item.id}
              className="-mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded border',
                  typeToneOf(item.color),
                )}
              >
                <ProcessTypeGlyph icon={item.icon} className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm">{item.name}</span>
                {item.description ? (
                  <span className="truncate text-xs text-muted-foreground" title={item.description}>
                    {item.description}
                  </span>
                ) : null}
              </span>
              <Switch
                checked={!typeConfigOf(item).creation.excludedProjectTypeIds.includes(type.id)}
                disabled={!canSetup || update.isPending}
                aria-label={`${item.name}: ${ui.automation.creationScope.projectSectionTitle}`}
                onCheckedChange={(checked) => toggle(item, checked)}
              />
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {group(ui.automation.creationScope.tasksGroup, tasks.data)}
      {group(ui.automation.creationScope.lettersGroup, letters.data)}
    </div>
  );
}
