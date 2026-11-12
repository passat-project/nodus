import type {
  ProcessCategory,
  TransitionDisplay,
  WorkflowDraftAction,
  WorkflowDraftDocument,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  PanelDanger,
  PanelField,
  SectionLink,
  Segmented,
  focusName,
} from '../../../../../shared/ui/panel/panel-kit.js';
import { rolesSummary, windowSummary } from './transition-panel.js';

const ANY = 'any';
const DISPLAYS: readonly TransitionDisplay[] = ['primary', 'button', 'menu'];
/** Подписи шагов (#633): в каталоге пока только пост-функции ядра. */
const STEP_LABELS: Record<string, string> = { ...ui.automation.postFunctions };

/**
 * Панель действия (#633) — кнопка маршрута без смены статуса. Та же
 * грамматика, что у кнопки-перехода: где показывается, название, показ,
 * разделы «Кто видит», «Окно действия», шаги (каталог — отдельная задача),
 * удаление. «Куда» здесь нет: статус не меняется.
 */
export function ActionPanel({
  action,
  document: doc,
  readOnly,
  category = 'task',
  autoFocusName,
  onOpenSection,
}: {
  action: WorkflowDraftAction;
  document: WorkflowDraftDocument;
  readOnly: boolean;
  category?: ProcessCategory;
  autoFocusName: boolean;
  onOpenSection: (section: 'roles' | 'window') => void;
}) {
  const store = useRouteDocStore.getState;
  const patch = (value: Partial<Omit<WorkflowDraftAction, 'id' | 'sortOrder'>>) =>
    store().patchAction(action.id, value);
  const stageName = (id: string | null) =>
    id === null
      ? ui.automation.panel.actionAtAny
      : (doc.stages.find((s) => s.id === id)?.name ?? '');
  const needsWindowOrSteps = !action.form.enabled && action.steps.length === 0;

  return (
    <>
      <PanelField label={ui.automation.panel.actionStage}>
        <Select
          value={action.stageId ?? ANY}
          disabled={readOnly}
          onValueChange={(value) => patch({ stageId: value === ANY ? null : value })}
        >
          <SelectTrigger
            className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"
            aria-label={ui.automation.panel.actionStage}
            title={stageName(action.stageId)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            <SelectItem value={ANY}>{ui.automation.panel.actionAtAny}</SelectItem>
            {doc.stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>

      <PanelField label={ui.automation.panel.actionName}>
        <Input
          key={action.id}
          value={action.name}
          maxLength={40}
          readOnly={readOnly}
          ref={autoFocusName ? focusName : undefined}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </PanelField>

      <PanelField
        label={ui.automation.panel.display}
        hint={ui.automation.panel.displayHints[action.display]}
      >
        <Segmented
          value={action.display}
          disabled={readOnly}
          options={DISPLAYS.map((d) => ({
            value: d,
            label: ui.automation.panel.displaySegments[d],
          }))}
          onChange={(display) =>
            display === 'primary' ? store().setActionPrimary(action.id) : patch({ display })
          }
        />
      </PanelField>

      <div className="flex min-w-0 flex-col">
        <SectionLink
          title={ui.automation.panel.sectionWhoSees}
          summary={rolesSummary(action.rules, category)}
          onClick={() => onOpenSection('roles')}
        />
        <SectionLink
          title={ui.automation.panel.actionWindow}
          summary={
            action.form?.enabled && action.form.title?.trim()
              ? action.form.title
              : windowSummary(action.form)
          }
          onClick={() => onOpenSection('window')}
        />
      </div>

      {/* Шаги: показываем только когда есть что показать (шаги) или когда
          без них действие не опубликуется — поле без содержимого и без
          возможности настроить было тупиком. */}
      {action.steps.length > 0 || needsWindowOrSteps ? (
        <PanelField
          label={ui.automation.panel.actionSteps}
          hint={needsWindowOrSteps ? ui.automation.panel.actionNeedsFormOrSteps : undefined}
        >
          {action.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ui.automation.panel.actionStepsEmpty}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-1 text-sm">
              {action.steps.map((step, index) => (
                <li key={`${step.kind}-${index}`} className="truncate">
                  {STEP_LABELS[step.kind] ?? step.kind}
                </li>
              ))}
            </ul>
          )}
        </PanelField>
      ) : null}

      {!readOnly ? (
        <PanelDanger onClick={() => store().removeAction(action.id)}>
          {ui.automation.panel.deleteAction}
        </PanelDanger>
      ) : null}
    </>
  );
}
