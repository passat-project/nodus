import type {
  ProcessCategory,
  TransitionDisplay,
  WorkflowDraftDocument,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { WORKFLOW_ROLES_BY_CATEGORY, WORKFLOW_VALIDATORS_BY_CATEGORY, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { ArrowRight } from 'lucide-react';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  VALIDATOR_KINDS,
  rolesOf,
  routeIfOf,
  routeIfWhenOf,
  validatorOf,
} from '../../../model/transition-rules.js';
import {
  PanelDanger,
  PanelField,
  SectionLink,
  Segmented,
  focusName,
} from '../../../../../shared/ui/panel/panel-kit.js';

export type TransitionSection = 'root' | 'roles' | 'conditions' | 'rules' | 'window';

const ANY = 'any';
const DISPLAYS: readonly TransitionDisplay[] = ['primary', 'button', 'menu'];
const INTENTS = ['action', 'service'] as const;

/** Сводки разделов (строка под названием раздела). */
export function sectionSummaries(
  transition: WorkflowDraftTransition,
  doc: WorkflowDraftDocument,
  category: ProcessCategory = 'task',
) {
  const roles = rolesOf(transition.rules);
  const roleOrder = WORKFLOW_ROLES_BY_CATEGORY[category];
  const validatorOrder = WORKFLOW_VALIDATORS_BY_CATEGORY[category] as readonly string[];
  const validators = VALIDATOR_KINDS.filter(
    (kind) => validatorOrder.includes(kind) && validatorOf(transition.rules, kind),
  );
  const routeIf = routeIfOf(transition.rules);
  const windowSummary = !transition.form.enabled
    ? ui.automation.window.summaryOff
    : transition.form.sections.length === 0
      ? ui.automation.window.summaryEmpty
      : transition.form.sections
          .map((section) => ui.automation.window.sections[section.kind])
          .join(', ');
  return {
    roles:
      roles.size > 0
        ? roleOrder
            .filter((r) => roles.has(r))
            .map((r) => ui.automation.roles[r])
            .join(', ')
        : ui.automation.panel.nobody,
    conditions:
      validators.length > 0
        ? validators.map((kind) => ui.automation.validators[kind]).join(', ')
        : ui.automation.panel.noConditions,
    rules:
      routeIf !== null
        ? `${
            routeIfWhenOf(transition.rules) === 'approver_is_actor'
              ? ui.automation.panel.routeIfSummaryApprover
              : ui.automation.panel.routeIfSummaryCreator
          } ${doc.stages.find((s) => s.id === routeIf)?.name ?? ''}`
        : ui.automation.panel.noRules,
    window: windowSummary,
  };
}

/**
 * Панель кнопки-перехода (#378 ред. 2) — та же грамматика, что у панели
 * статуса: сверху «Откуда → Куда», название, показ сегментами, разделы
 * «Кто видит ›», «Условия перехода ›», «Особые правила ›» со сводками,
 * удаление. Вид кнопок статуса в карточке — в разделе «Кнопки из статуса»
 * панели статуса (здесь не дублируется).
 */
export function TransitionPanel({
  transition: t,
  document: doc,
  readOnly,
  autoFocusName,
  onOpenSection,
  category = 'task',
}: {
  transition: WorkflowDraftTransition;
  document: WorkflowDraftDocument;
  readOnly: boolean;
  autoFocusName: boolean;
  onOpenSection: (section: Exclude<TransitionSection, 'root'>) => void;
  /** Категория типа (Р6): у письма свои роли, нет гейтов и route_if,
   *  а пост-действие «Присвоить номер» только показывается. */
  category?: ProcessCategory;
}) {
  const store = useRouteDocStore.getState;
  const patch = (value: Partial<WorkflowDraftTransition>) => store().patchTransition(t.id, value);
  const summaries = sectionSummaries(t, doc, category);
  const stageName = (id: string | null) =>
    id === null ? ui.automation.anyStatus : (doc.stages.find((s) => s.id === id)?.name ?? '');

  return (
    <>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        <PanelField label={ui.automation.fromStage}>
          <Select
            value={t.fromStageId ?? ANY}
            disabled={readOnly}
            onValueChange={(value) => patch({ fromStageId: value === ANY ? null : value })}
          >
            <SelectTrigger
              className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"
              aria-label={ui.automation.fromStage}
              title={stageName(t.fromStageId)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              <SelectItem value={ANY}>{ui.automation.anyStatus}</SelectItem>
              {doc.stages
                .filter((s) => s.id !== t.toStageId)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </PanelField>
        <ArrowRight className="mb-2 size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <PanelField label={ui.automation.toStage}>
          <Select
            value={t.toStageId}
            disabled={readOnly}
            onValueChange={(value) => patch({ toStageId: value })}
          >
            <SelectTrigger
              className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"
              aria-label={ui.automation.toStage}
              title={stageName(t.toStageId)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              {doc.stages
                .filter((s) => s.id !== t.fromStageId)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </PanelField>
      </div>

      <PanelField label={ui.automation.transitionName}>
        <Input
          key={t.id}
          value={t.name}
          maxLength={32}
          readOnly={readOnly}
          ref={autoFocusName ? focusName : undefined}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </PanelField>

      <PanelField
        label={ui.automation.panel.display}
        hint={ui.automation.panel.displayHints[t.display]}
      >
        <Segmented
          value={t.display}
          disabled={readOnly}
          options={DISPLAYS.map((d) => ({
            value: d,
            label: ui.automation.panel.displaySegments[d],
          }))}
          onChange={(display) =>
            display === 'primary' ? store().setTransitionPrimary(t.id) : patch({ display })
          }
        />
      </PanelField>

      <PanelField
        label={ui.automation.panel.intent}
        hint={
          t.intent === 'action'
            ? ui.automation.panel.intentActionHint
            : ui.automation.panel.intentServiceHint
        }
      >
        {' '}
        <Segmented
          value={t.intent}
          disabled={readOnly}
          options={INTENTS.map((intent) => ({
            value: intent,
            label: ui.automation.panel.intentSegments[intent],
          }))}
          onChange={(intent) => patch({ intent })}
        />
      </PanelField>

      <div className="flex min-w-0 flex-col">
        <SectionLink
          title={ui.automation.panel.sectionWhoSees}
          summary={summaries.roles}
          onClick={() => onOpenSection('roles')}
        />
        {category === 'task' ? (
          <SectionLink
            title={ui.automation.panel.sectionConditions}
            summary={summaries.conditions}
            onClick={() => onOpenSection('conditions')}
          />
        ) : null}
        {category === 'task' ? (
          <SectionLink
            title={ui.automation.panel.sectionRules}
            summary={summaries.rules}
            onClick={() => onOpenSection('rules')}
          />
        ) : null}
        <SectionLink
          title={ui.automation.panel.sectionWindow}
          summary={summaries.window}
          onClick={() => onOpenSection('window')}
        />
      </div>

      {!readOnly ? (
        <PanelDanger onClick={() => store().removeTransition(t.id)}>
          {ui.automation.deleteTransition}
        </PanelDanger>
      ) : null}
    </>
  );
}
