import type {
  TransitionFormSectionKind,
  WorkflowDraftDocument,
  WorkflowDraftTransition,
  WorkflowTransition,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { toggleValidator, validatorOf } from '../../../model/transition-rules.js';

/** Подписи разделов окна — фиксированный порядок редактора (#380). */
export const SECTION_TITLES: Record<TransitionFormSectionKind, string> = {
  fields: ui.automation.window.sections.fields,
  time: ui.automation.window.sections.time,
  result: ui.automation.window.sections.result,
  result_files: ui.automation.window.sections.result_files,
  result_messages: ui.automation.window.sections.result_messages,
  comment: ui.automation.window.sections.comment,
  registration: ui.automation.window.sections.registration,
};

/** Флажок раздела: включён — настройки раздела видны под ним. */
export function SectionToggle({
  kind,
  transition,
  readOnly,
  onToggle,
  children,
}: {
  kind: TransitionFormSectionKind;
  transition: WorkflowDraftTransition;
  readOnly: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const enabled = transition.form.sections.some((s) => s.kind === kind);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex items-start gap-2.5">
        <Checkbox
          className="mt-0.5"
          checked={enabled}
          disabled={readOnly}
          onCheckedChange={onToggle}
          aria-label={SECTION_TITLES[kind]}
        />
        <span className="text-sm">{SECTION_TITLES[kind]}</span>
      </label>
      {enabled ? <div className="flex flex-col gap-2 pl-6.5">{children}</div> : null}
    </div>
  );
}

/** «Обязательно» у времени/итога — это гейт кнопки (Р3), не свойство раздела. */
export function GateCheck({
  transition,
  kind,
  disabled,
}: {
  transition: WorkflowDraftTransition;
  kind: 'time_logged' | 'result_present';
  disabled: boolean;
}) {
  const checked = validatorOf(transition.rules, kind) !== undefined;
  return (
    <RequiredCheck
      checked={checked}
      disabled={disabled}
      onChange={() =>
        useRouteDocStore.getState().patchTransition(transition.id, {
          rules: toggleValidator(transition.rules, kind),
        })
      }
    />
  );
}

export function RequiredCheck({
  checked,
  disabled,
  onChange,
  title = ui.automation.window.required,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {title}
    </label>
  );
}

/** Кнопка черновика → DTO превью (id new:* допустим: превью не ходит на сервер). */
export function previewTransition(
  t: WorkflowDraftTransition,
  doc: WorkflowDraftDocument,
): WorkflowTransition {
  const target = doc.stages.find((s) => s.id === t.toStageId);
  return {
    id: t.id,
    name: t.name || ui.automation.window.preview,
    toStageId: t.toStageId,
    toStageName: target?.name ?? '',
    toStageState: target?.systemState ?? 'active',
    toStageOutcome: target?.outcome ?? null,
    toStageColor: target?.color ?? 'neutral',
    toStageOrder: target?.sortOrder ?? 0,
    display: t.display,
    intent: t.intent,
    blockedBy: [],
    canOverride: false,
    form: t.form.enabled ? t.form : null,
    validators: t.rules.validators,
  };
}
