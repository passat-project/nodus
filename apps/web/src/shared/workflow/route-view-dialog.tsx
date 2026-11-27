import { useMemo } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useNavigate } from '@tanstack/react-router';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';
import { Permission, ui } from '@nodus/contracts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { Button } from '@nodus/ui/components/button';
import { Workflow, X } from 'lucide-react';

import { useAuthStore } from '../auth-store.js';
import { FlowCanvas } from '../flow/flow-canvas.js';
import { buildRouteGraph } from '../flow/route-graph.js';
import { replaceProcessesSurface } from './processes-surface-search.js';
import { useWorkflowDetail } from './workflow-api.js';

/**
 * «Схема маршрута» задачи (#378): большой диалог (~1200×80vh) с холстом
 * только для чтения — расстановка общая (как её оставил настройщик),
 * текущий статус светится, кнопки, доступные пользователю, — в силе,
 * остальные приглушены. Холст вписывается после раскрытия диалога.
 * «Открыть в редакторе» — только с правом `workflow.manage`.
 */
export function RouteViewDialog({
  open,
  onClose,
  task,
  transitions,
}: {
  open: boolean;
  onClose: () => void;
  task: TaskDetail;
  transitions: readonly WorkflowTransition[] | undefined;
}) {
  const workflow = useWorkflowDetail(open ? task.workflowId : null);
  const navigate = useNavigate();
  const canManage = (useAuthStore((s) => s.user?.permissions) ?? []).includes(
    Permission.WORKFLOW_MANAGE,
  );

  const graph = useMemo(() => {
    if (!workflow.data) return null;
    return buildRouteGraph(workflow.data.document, {
      readOnly: true,
      currentStageId: task.stage.id,
      highlightedTransitionIds: new Set(transitions?.map((t) => t.id) ?? []),
    });
  }, [workflow.data, task.stage.id, transitions]);

  const typeId = workflow.data?.typeIds[0];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[80vh] w-[92vw] max-w-[1200px] flex-col sm:max-w-[1200px]"
      >
        {/* Крестик — в СТРОКЕ шапки, а не absolute-углом корпуса: он стоит
            на одной линии с заголовком и «Открыть в редакторе» (вердикт
            владельца 22.10, скриншот «крестик выше надписей»). */}
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <DialogTitle>
            {ui.automation.routeViewOfType} «{task.type.name}»
          </DialogTitle>
          <span className="flex shrink-0 items-center gap-1">
            {canManage && typeId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClose();
                  void navigate({
                    to: '/automation',
                    search: (prev) =>
                      replaceProcessesSurface({ ...prev, tab: 'processes' }, { type: typeId }),
                  });
                }}
              >
                <Workflow className="size-3.5" strokeWidth={1.75} />
                {ui.automation.openInEditor}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={ui.common.close}
              title={ui.common.close}
              onClick={onClose}
            >
              <X className="size-4" strokeWidth={1.75} />
            </Button>
          </span>
        </DialogHeader>
        <div className="min-h-0 flex-1 rounded-[14px] border">
          {graph ? (
            <ReactFlowProvider>
              <FlowCanvas nodes={graph.nodes} edges={graph.edges} interactive={false} />
            </ReactFlowProvider>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
