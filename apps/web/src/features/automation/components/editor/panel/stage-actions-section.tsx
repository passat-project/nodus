import type {
  WorkflowDraftAction,
  WorkflowDraftDocument,
  WorkflowDraftStage,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Plus, Trash2 } from 'lucide-react';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { PanelAction, SectionLink } from '../../../../../shared/ui/panel/panel-kit.js';
import { ReorderButtons } from './reorder-buttons.js';

const bySortOrder = (a: WorkflowDraftAction, b: WorkflowDraftAction) => a.sortOrder - b.sortOrder;

/** Действия статуса: свои (порядок задаётся тут) + «в любом статусе». */
export function stageActions(doc: WorkflowDraftDocument, stageId: string) {
  const actions = doc.actions ?? [];
  return {
    own: actions.filter((a) => a.stageId === stageId).sort(bySortOrder),
    fromAny: actions.filter((a) => a.stageId === null).sort(bySortOrder),
  };
}

/** Сводка строки «Действия ›»: до трёх названий + «ещё N». */
export function stageActionsSummary(doc: WorkflowDraftDocument, stageId: string): string {
  const { own, fromAny } = stageActions(doc, stageId);
  const total = own.length + fromAny.length;
  if (total === 0) return ui.automation.panel.noActions;
  const head = [...own, ...fromAny].slice(0, 3).map((a) => a.name);
  const rest = total - head.length;
  return rest > 0
    ? `${head.join(', ')}, ${ui.automation.panel.moreActions} ${rest}`
    : head.join(', ');
}

/** Сводка действия в списке: показ + чем нажимается (окно/шаги). */
function actionSummary(action: WorkflowDraftAction): string {
  const parts: string[] = [ui.automation.panel.displaySegments[action.display]];
  if (action.form.enabled) parts.push(ui.automation.panel.actionWindow);
  if (action.steps.length > 0) parts.push(ui.automation.panel.actionSteps);
  return parts.join(' · ');
}

/**
 * Раздел «Действия» панели статуса (#633): кнопки без смены статуса — по
 * порядку в карточке (клик — панель действия, стрелки — порядок), добавление
 * и удаление. Настройки самого действия (кто видит, окно, шаги) живут в его
 * панели — здесь только список и порядок.
 */
export function StageActionsSection({
  stage,
  document: doc,
  readOnly,
}: {
  stage: WorkflowDraftStage;
  document: WorkflowDraftDocument;
  readOnly: boolean;
}) {
  const store = useRouteDocStore.getState;
  const { own, fromAny } = stageActions(doc, stage.id);
  const open = (id: string) => store().select({ kind: 'action', id });

  const row = (action: WorkflowDraftAction, index: number) => (
    <SectionLink
      key={action.id}
      title={action.name}
      summary={
        action.stageId === null
          ? `${actionSummary(action)} · ${ui.automation.panel.fromAnyStatus}`
          : actionSummary(action)
      }
      onClick={() => open(action.id)}
      actions={
        readOnly ? undefined : (
          <span className="flex shrink-0 items-center">
            {action.stageId === null || own.length < 2 ? null : (
              <ReorderButtons
                index={index}
                count={own.length}
                onMove={(to) => store().moveAction(action.id, to)}
              />
            )}
            <button
              type="button"
              aria-label={ui.automation.panel.deleteAction}
              title={ui.automation.panel.deleteAction}
              onClick={() => store().removeAction(action.id)}
              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-danger focus-visible:opacity-100"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </span>
        )
      }
    />
  );

  return (
    <div className="flex min-w-0 flex-col">
      <p className="pb-1.5 text-xs text-muted-foreground">{ui.automation.panel.actionsLead}</p>
      {own.map((action, index) => row(action, index))}
      {fromAny.map((action, index) => row(action, index))}
      {own.length + fromAny.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{ui.automation.panel.noActions}</p>
      ) : null}
      {!readOnly ? (
        <PanelAction icon={Plus} onClick={() => store().addAction(stage.id)}>
          {ui.automation.panel.addActionLabel}
        </PanelAction>
      ) : null}
    </div>
  );
}
