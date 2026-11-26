import { typeConfigOf, ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Switch } from '@nodus/ui/components/switch';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { cn } from '@nodus/ui/lib/utils';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';
import { PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../../shared/workflow/type-tone.js';

/**
 * Страница «Без проекта» (#857, единая модель §4): какие типы задач можно
 * ставить без проекта — лёгкие внутренние задачи без автоматизации схемы.
 * Строки «Без проекта» — одна сторона связи «где создаётся» (#665): запись
 * через настройку самого типа. Без права `workflow.manage` — только
 * просмотр с пояснением (паттерн #665, сервер — истина, I8).
 */
export function WithoutProjectPage({ canManage }: { canManage: boolean }) {
  const tasks = useLiveProcessTypes('task');
  const update = useUpdateTypeCreation();
  const rows = tasks.data ?? [];

  function toggle(
    typeId: string,
    scope: ReturnType<typeof typeConfigOf>['creation'],
    value: boolean,
  ) {
    update.mutate({ typeId, creation: { ...scope, withoutProject: value } });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <NodeLabel label={ui.automation.entry.noProjectTitle} count={rows.length} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-5">
          <p className="text-sm text-muted-foreground">{ui.automation.entry.noProjectHint}</p>
          {!canManage ? (
            <PanelNote>{ui.automation.creationScope.noWorkflowPermission}</PanelNote>
          ) : null}
          {rows.length === 0 ? (
            <Empty>
              <EmptyTitle>{ui.automation.entry.noProjectEmpty}</EmptyTitle>
            </Empty>
          ) : (
            rows.map((type) => {
              const scope = typeConfigOf(type).creation;
              return (
                <div
                  key={type.id}
                  className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg border',
                      typeToneOf(type.color),
                    )}
                  >
                    <ProcessTypeGlyph icon={type.icon} className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{type.name}</span>
                    {type.description ? (
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={type.description}
                      >
                        {type.description}
                      </span>
                    ) : null}
                  </span>
                  <Switch
                    checked={scope.withoutProject}
                    disabled={!canManage || update.isPending}
                    aria-label={`${type.name}: ${ui.automation.entry.noProjectToggle}`}
                    onCheckedChange={(checked) => toggle(type.id, scope, checked)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
