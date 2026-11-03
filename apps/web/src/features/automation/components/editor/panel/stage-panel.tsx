import type {
  StageColor,
  TaskSystemState,
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowStageName,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';

import { stageColorOrder, stageTone } from '../../../../../shared/ui/board/stage-tone.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  PanelDanger,
  PanelField,
  SectionLink,
  Segmented,
  SwitchRow,
  focusName,
} from '../../../../../shared/ui/panel/panel-kit.js';
import { stageButtonsSummary } from './stage-buttons-section.js';
import { StageNameField } from './stage-name-field.js';

const GROUPS: readonly TaskSystemState[] = ['backlog', 'active', 'paused', 'done', 'closed'];

/** Подсказка под выбором группы: смысл выбранной группы + зачем она нужна
 *  (в списке — только названия, одной строкой). */
function groupHint(group: TaskSystemState): string {
  const meaning = ui.automation.bandHints[group];
  return `${meaning.charAt(0).toUpperCase()}${meaning.slice(1)}. ${ui.automation.panel.stageGroupWhy}`;
}

/**
 * Панель статуса (#378 ред. 2) — та же грамматика, что у панели кнопки:
 * поля самого статуса (имя, группа с пояснением, цвет, итог у «Итога»,
 * начальный, «из любого статуса»), дальше строки «›» — кнопка «из любого
 * статуса» (её настройки — в панели кнопки, здесь не дублируются) и раздел
 * «Кнопки из статуса» (список, порядок, добавление, вид в карточке), внизу —
 * удаление.
 */
export function StagePanel({
  stage,
  document: doc,
  taskCount,
  readOnly,
  autoFocusName,
  onOpenButtons,
  stageNameSuggestions = [],
  stageNameLoading = false,
}: {
  stage: WorkflowDraftStage;
  document: WorkflowDraftDocument;
  taskCount: number;
  readOnly: boolean;
  autoFocusName: boolean;
  onOpenButtons: () => void;
  stageNameSuggestions?: readonly WorkflowStageName[];
  stageNameLoading?: boolean;
}) {
  const store = useRouteDocStore.getState;
  const patch = (value: Partial<WorkflowDraftStage>) => store().patchStage(stage.id, value);
  const anyButton = doc.transitions.find((t) => t.fromStageId === null && t.toStageId === stage.id);

  return (
    <>
      <PanelField label={ui.automation.stageName}>
        <StageNameField
          value={stage.name}
          systemState={stage.systemState}
          suggestions={stageNameSuggestions}
          loading={stageNameLoading}
          readOnly={readOnly}
          autoFocus={autoFocusName}
          onChange={(name) => patch({ name })}
        />
      </PanelField>

      <PanelField label={ui.automation.panel.stageGroup} hint={groupHint(stage.systemState)}>
        <Select
          value={stage.systemState}
          disabled={readOnly}
          onValueChange={(value) => {
            const systemState = value as TaskSystemState;
            patch({
              systemState,
              outcome: systemState === 'closed' ? (stage.outcome ?? 'success') : null,
            });
          }}
        >
          <SelectTrigger className="w-full min-w-0" aria-label={ui.automation.panel.stageGroup}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {GROUPS.map((group) => (
              <SelectItem key={group} value={group}>
                {ui.automation.bands[group]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>

      <PanelField label={ui.automation.stageColor}>
        <div className="flex flex-wrap gap-2">
          {stageColorOrder.map((tone: StageColor) => (
            <button
              key={tone}
              type="button"
              aria-pressed={stage.color === tone}
              aria-label={ui.tasks.stageColors[tone]}
              title={ui.tasks.stageColors[tone]}
              disabled={readOnly}
              onClick={() => patch({ color: tone })}
              className={cn(
                'size-6 rounded-full border-2 transition-colors',
                stageTone[tone].swatch,
                stage.color === tone ? 'border-foreground' : 'border-transparent',
              )}
            />
          ))}
        </div>
      </PanelField>

      {stage.systemState === 'closed' ? (
        <PanelField
          label={ui.automation.stageOutcome}
          hint={ui.automation.outcomeHints[stage.outcome ?? 'success']}
        >
          <Segmented
            value={stage.outcome ?? 'success'}
            disabled={readOnly}
            options={[
              { value: 'success', label: ui.automation.outcomeSuccess },
              { value: 'cancelled', label: ui.automation.outcomeCancelled },
              { value: 'rejected', label: ui.automation.outcomeRejected },
            ]}
            onChange={(outcome) => patch({ outcome })}
          />
        </PanelField>
      ) : null}

      <SwitchRow
        title={ui.automation.isInitial}
        hint={ui.automation.isInitialHint}
        checked={stage.isInitial}
        disabled={readOnly}
        onChange={(checked) => patch({ isInitial: checked })}
      />

      <SwitchRow
        title={ui.automation.panel.canAnyFrom}
        hint={ui.automation.panel.canAnyFromHint}
        checked={anyButton !== undefined}
        disabled={readOnly}
        onChange={(checked) => store().toggleAny(stage.id, checked)}
      />

      <div className="flex min-w-0 flex-col">
        {anyButton ? (
          <SectionLink
            title={anyButton.name}
            summary={`${ui.automation.panel.anyButtonSummary} · ${ui.automation.panel.displaySegments[anyButton.display]}`}
            onClick={() => store().select({ kind: 'transition', id: anyButton.id })}
          />
        ) : null}
        <SectionLink
          title={ui.automation.panel.sectionButtons}
          summary={stageButtonsSummary(doc, stage.id)}
          onClick={onOpenButtons}
        />
      </div>

      {!readOnly ? (
        <PanelDanger onClick={() => store().removeStage(stage.id)}>
          {ui.automation.deleteStage}
          {taskCount > 0 ? (
            <span className="ml-1 text-xs text-muted-foreground">
              · {taskCount} {ui.automation.deleteStageTasksNote}
            </span>
          ) : null}
        </PanelDanger>
      ) : null}
    </>
  );
}
