import type {
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { AddTransitionPopover } from '../add-transition-popover.js';
import { ProcessPreview } from '../process-preview.js';
import { PanelAction, PanelField, SectionLink } from '../../../../../shared/ui/panel/panel-kit.js';

const bySortOrder = (a: WorkflowDraftTransition, b: WorkflowDraftTransition) =>
  a.sortOrder - b.sortOrder;

/** Кнопки статуса в карточке: свои (порядок задаётся тут) + «из любого
 *  статуса», ведущие в другие статусы. */
export function stageButtons(doc: WorkflowDraftDocument, stageId: string) {
  return {
    own: doc.transitions.filter((t) => t.fromStageId === stageId).sort(bySortOrder),
    fromAny: doc.transitions
      .filter((t) => t.fromStageId === null && t.toStageId !== stageId)
      .sort(bySortOrder),
  };
}

/** Сводка строки «Кнопки из статуса ›»: до трёх названий + «ещё N». */
export function stageButtonsSummary(doc: WorkflowDraftDocument, stageId: string): string {
  const { own } = stageButtons(doc, stageId);
  if (own.length === 0) return ui.automation.panel.noButtons;
  const head = own.slice(0, 3).map((t) => t.name);
  const rest = own.length - head.length;
  return rest > 0
    ? `${head.join(', ')}, ${ui.automation.panel.moreButtons} ${rest}`
    : head.join(', ');
}

function Reorder({
  index,
  count,
  onMove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  return (
    <span className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        aria-label={ui.automation.moveUp}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
      >
        <ArrowUp className="size-3" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={ui.automation.moveDown}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
      >
        <ArrowDown className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

/**
 * Раздел «Кнопки из статуса» (переход внутрь из панели статуса): кнопки по
 * порядку в карточке (клик — панель кнопки, стрелки — порядок), добавление
 * перехода и «Как увидят в карточке задачи». Всё о кнопках статуса — в одном
 * месте, в корне панели — только сводка.
 */
export function StageButtonsSection({
  stage,
  document: doc,
  readOnly,
}: {
  stage: WorkflowDraftStage;
  document: WorkflowDraftDocument;
  readOnly: boolean;
}) {
  const store = useRouteDocStore.getState;
  const { own, fromAny } = stageButtons(doc, stage.id);
  const stageName = (id: string) => doc.stages.find((s) => s.id === id)?.name ?? '';
  const open = (id: string) => store().select({ kind: 'transition', id });
  const mode = (t: WorkflowDraftTransition) => ui.automation.panel.displaySegments[t.display];

  return (
    <>
      <div className="flex min-w-0 flex-col">
        {own.map((t, index) => (
          <SectionLink
            key={t.id}
            title={t.name}
            summary={`→ ${stageName(t.toStageId)} · ${mode(t)}`}
            onClick={() => open(t.id)}
            actions={
              readOnly ? undefined : (
                <Reorder
                  index={index}
                  count={own.length}
                  onMove={(to) => store().moveTransition(t.id, to)}
                />
              )
            }
          />
        ))}
        {fromAny.map((t) => (
          <SectionLink
            key={t.id}
            title={t.name}
            summary={`→ ${stageName(t.toStageId)} · ${ui.automation.panel.fromAnyStatus} · ${mode(t)}`}
            onClick={() => open(t.id)}
          />
        ))}
        {own.length + fromAny.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{ui.automation.panel.noButtons}</p>
        ) : null}
        {!readOnly ? (
          <AddTransitionPopover
            document={doc}
            defaultFrom={stage.id}
            onPick={(from, to) => store().addTransition(from, to)}
            trigger={<PanelAction icon={Plus}>{ui.automation.addTransitionLabel}</PanelAction>}
          />
        ) : null}
      </div>

      <PanelField label={ui.automation.previewTitle}>
        <ProcessPreview transitions={[...own, ...fromAny]} />
      </PanelField>
    </>
  );
}
