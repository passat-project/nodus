import type {
  CustomFieldModule,
  ProcessCategory,
  WorkflowDraftDocument,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { CUSTOM_FIELD_LIMITS, WORKFLOW_VALIDATORS_BY_CATEGORY, ui } from '@nodus/contracts';
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
  REQUIRABLE_FIELDS,
  VALIDATOR_KINDS,
  assignNumberFieldOf,
  defaultRouteIfTarget,
  routeIfOf,
  routeIfWhenOf,
  setAllowReview,
  setAssignNumber,
  setMinFiles,
  setRouteIf,
  setRouteIfWhen,
  toggleField,
  toggleValidator,
  validatorOf,
} from '../../../model/transition-rules.js';
import { ModeChoices, PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { CustomFieldChecks } from './custom-fields-checks.js';
import { CheckRow } from './transition-roles-section.js';

/**
 * Разделы панели кнопки (#378 ред. 2, «переход внутрь» как в Трекере):
 * «Кто видит», «Условия перехода» (DoD: подзадачи с галочкой «на утверждении
 * не мешают», чек-лист, время, итог, поля), «Особые правила» (route_if).
 * Структура позволяет добавить разделы эпика (окно перехода, утверждающие)
 * без переделки.
 */

type Rules = WorkflowDraftTransition['rules'];

function usePatchRules(transition: WorkflowDraftTransition) {
  return (next: Rules) => {
    if (next !== transition.rules) {
      useRouteDocStore.getState().patchTransition(transition.id, { rules: next });
    }
  };
}

export function ConditionsSection({
  transition,
  scope,
  typeId,
  readOnly,
  category = 'task',
}: {
  transition: WorkflowDraftTransition;
  scope: CustomFieldModule;
  /** Тип процесса: в гейт выбираются только его атрибуты (#432, Р8). */
  typeId?: string;
  readOnly: boolean;
  /** Гейты категории (Р6): у писем в #55 их нет — задачные факты не считаются. */
  category?: ProcessCategory;
}) {
  const patch = usePatchRules(transition);
  const rules = transition.rules;
  const subtasks = validatorOf(rules, 'no_open_subtasks');
  const fields = validatorOf(rules, 'fields_required');
  const files = validatorOf(rules, 'result_files');
  const kinds = VALIDATOR_KINDS.filter((kind) =>
    (WORKFLOW_VALIDATORS_BY_CATEGORY[category] as readonly string[]).includes(kind),
  );
  if (kinds.length === 0) {
    return (
      <p className="text-sm break-words text-muted-foreground">
        {ui.automation.panel.noConditions}
      </p>
    );
  }
  return (
    <>
      <p className="text-sm break-words text-muted-foreground">
        {ui.automation.panel.conditionsLead}
      </p>
      {kinds.map((kind) => (
        <CheckRow
          key={kind}
          checked={validatorOf(rules, kind) !== undefined}
          disabled={readOnly}
          title={ui.automation.validators[kind]}
          hint={ui.automation.panel.validatorHints[kind]}
          onChange={() => patch(toggleValidator(rules, kind))}
        >
          {kind === 'no_open_subtasks' && subtasks ? (
            <CheckRow
              checked={subtasks.allowReview === true}
              disabled={readOnly}
              title={ui.automation.panel.allowReviewSubtasks}
              onChange={(checked) => patch(setAllowReview(rules, checked))}
            />
          ) : null}
          {kind === 'result_files' && files ? (
            <PanelField label={ui.automation.window.minFiles}>
              <Input
                type="number"
                min={1}
                max={5}
                value={files.min}
                disabled={readOnly}
                aria-label={ui.automation.window.minFiles}
                onChange={(e) => patch(setMinFiles(rules, Number(e.target.value)))}
              />
            </PanelField>
          ) : null}
          {kind === 'fields_required' && fields ? (
            <>
              {REQUIRABLE_FIELDS.map((field) => (
                <CheckRow
                  key={field}
                  checked={fields.fields.includes(field)}
                  disabled={
                    readOnly || (fields.fields.length === 1 && fields.fields.includes(field))
                  }
                  title={
                    field === 'result' ? ui.tasks.result : ui.automation.requirableFields[field]
                  }
                  onChange={() => patch(toggleField(rules, field))}
                />
              ))}
              <CustomFieldChecks
                scope={scope}
                typeId={typeId}
                selected={fields.fields}
                disabled={readOnly}
                limit={CUSTOM_FIELD_LIMITS.gateFields}
                limitHint={ui.automation.panel.gateFieldsLimit}
                onToggle={(key) => patch(toggleField(rules, key))}
              />
            </>
          ) : null}
        </CheckRow>
      ))}
      <p className="text-xs break-words text-muted-foreground">{ui.automation.conditionsHint}</p>
    </>
  );
}

export function RulesSection({
  transition,
  document: doc,
  readOnly,
  category = 'task',
  typeId,
}: {
  transition: WorkflowDraftTransition;
  document: WorkflowDraftDocument;
  readOnly: boolean;
  /** Пост-действия категории (Р6): у письма — только «Присвоить номер»,
   *  правка каталога закрыта — показываем, что делает кнопка. */
  category?: ProcessCategory;
  /** Тип процесса: counter-поля для «Присвоить номер» (#630, Р4). */
  typeId?: string;
}) {
  const patch = usePatchRules(transition);
  const target = routeIfOf(transition.rules);
  // Counter-поля типа с настроенным правилом — цель «Присвоить номер»
  // (#630, Р6); хук до условного return (правила хуков).
  const definitions = useCustomFieldDefinitions('task');
  const counterFields = (definitions.data ?? []).filter(
    (entry) =>
      entry.type === 'counter' &&
      entry.numbering != null &&
      (typeId ? entry.bindings.processTypeIds.includes(typeId) : true),
  );
  const assignField = assignNumberFieldOf(transition.rules);
  if (category !== 'task') {
    const posts = transition.rules.postFunctions;
    return (
      <>
        {posts.length > 0 ? (
          posts.map((post) => (
            <p key={post.kind} className="text-sm">
              {ui.automation.postFunctions[post.kind as keyof typeof ui.automation.postFunctions]}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{ui.automation.panel.noRules}</p>
        )}
        <p className="text-xs break-words text-muted-foreground">
          {ui.automation.letterCatalogLockedShort}
        </p>
      </>
    );
  }
  return (
    <>
      <SwitchRow
        title={ui.automation.panel.routeIfToggle}
        hint={ui.automation.panel.routeIfHint}
        checked={target !== null}
        disabled={readOnly}
        onChange={(checked) =>
          patch(
            setRouteIf(transition.rules, checked ? defaultRouteIfTarget(doc, transition) : null),
          )
        }
      />
      {target !== null ? (
        <PanelField label={ui.automation.panel.routeIfCondition}>
          <ModeChoices<'approver_is_actor' | 'creator_is_assignee'>
            value={routeIfWhenOf(transition.rules) ?? 'approver_is_actor'}
            disabled={readOnly}
            ariaLabel={ui.automation.panel.routeIfCondition}
            options={[
              {
                value: 'approver_is_actor',
                label: ui.automation.panel.routeIfConditionApprover,
                hint: ui.automation.panel.routeIfConditionHints.approver_is_actor,
              },
              {
                value: 'creator_is_assignee',
                label: ui.automation.panel.routeIfConditionCreator,
                hint: ui.automation.panel.routeIfConditionHints.creator_is_assignee,
              },
            ]}
            onChange={(when) => patch(setRouteIfWhen(transition.rules, when))}
          />
        </PanelField>
      ) : null}
      {target !== null ? (
        <PanelField label={ui.automation.panel.routeIfTarget}>
          <Select
            value={target}
            disabled={readOnly}
            onValueChange={(value) => patch(setRouteIf(transition.rules, value))}
          >
            <SelectTrigger
              className="w-full min-w-0"
              aria-label={ui.automation.panel.routeIfTarget}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              {doc.stages
                .filter((s) => s.id !== transition.toStageId)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </PanelField>
      ) : null}
      <SwitchRow
        title={ui.automation.postFunctions.assign_number}
        hint={ui.automation.panel.assignNumberHint}
        checked={assignField !== null}
        disabled={readOnly || counterFields.length === 0}
        onChange={(checked) =>
          patch(setAssignNumber(transition.rules, checked ? counterFields[0]!.id : null))
        }
      />
      {assignField !== null ? (
        <PanelField label={ui.automation.panel.assignNumberField}>
          <Select
            value={assignField}
            disabled={readOnly}
            onValueChange={(value) => patch(setAssignNumber(transition.rules, value))}
          >
            <SelectTrigger
              className="w-full min-w-0"
              aria-label={ui.automation.panel.assignNumberField}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              {counterFields.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelField>
      ) : counterFields.length === 0 ? (
        <p className="text-xs text-muted-foreground">{ui.automation.panel.assignNumberNoFields}</p>
      ) : null}
    </>
  );
}
