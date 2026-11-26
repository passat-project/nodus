import type { NodeKind } from '@nodus/contracts';
import { typeConfigOf, ui } from '@nodus/contracts';
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
 * Раздел «Работы в папке» экрана типа папки (#857, единая модель §11):
 * типы задач, привязанные к этому типу папки (`creation.folderKindId`,
 * #665 — одна связь, вторая сторона — «Где создаётся» типа задачи).
 * Запись требует `workflow.manage`; без права — только просмотр с
 * пояснением (паттерн #665, сервер — истина, I8).
 */
export function NodeKindWorksSection({ kind, canManage }: { kind: NodeKind; canManage: boolean }) {
  const tasks = useLiveProcessTypes('task');
  const update = useUpdateTypeCreation();
  const rows = tasks.data ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{ui.nodeKinds.screen.worksHint}</p>
      {!canManage ? (
        <PanelNote>{ui.automation.creationScope.noWorkflowPermission}</PanelNote>
      ) : null}
      {rows.length === 0 ? (
        <Empty>
          <EmptyTitle>{ui.nodeKinds.screen.worksEmpty}</EmptyTitle>
        </Empty>
      ) : (
        rows.map((type) => {
          const scope = typeConfigOf(type).creation;
          const bound = scope.folderKindId === kind.id;
          return (
            <div
              key={type.id}
              className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/60"
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
                  <span className="truncate text-xs text-muted-foreground" title={type.description}>
                    {type.description}
                  </span>
                ) : null}
              </span>
              <Switch
                checked={bound}
                disabled={!canManage || update.isPending}
                aria-label={`${type.name}: ${ui.nodeKinds.screen.worksBound}`}
                onCheckedChange={(checked) =>
                  update.mutate({
                    typeId: type.id,
                    creation: {
                      ...typeConfigOf(type).creation,
                      folderKindId: checked ? kind.id : null,
                    },
                  })
                }
              />
            </div>
          );
        })
      )}
    </div>
  );
}
