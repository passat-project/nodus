import type { ProcessCategory, WorkflowDraftTransition } from '@nodus/contracts';
import { WORKFLOW_ROLES_BY_CATEGORY, ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';

import { deciderSourcesOf, rolesOf, toggleRole } from '../../../model/transition-rules.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';

type Rules = WorkflowDraftTransition['rules'];

/** Строка с чекбоксом — общая для разделов панели кнопки. */
export function CheckRow({
  checked,
  disabled,
  title,
  hint,
  onChange,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  title: string;
  hint?: string;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex min-w-0 items-start gap-2.5">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onChange(value === true)}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm">{title}</span>
          {hint ? <span className="text-xs break-words text-muted-foreground">{hint}</span> : null}
        </span>
      </label>
      {children ? <div className="flex min-w-0 flex-col gap-2 pl-6.5">{children}</div> : null}
    </div>
  );
}

function usePatchRules(transition: WorkflowDraftTransition) {
  return (next: Rules) => {
    if (next !== transition.rules) {
      useRouteDocStore.getState().patchTransition(transition.id, { rules: next });
    }
  };
}

/** «Кто видит»: роли категории. Последнюю роль снять можно, если кнопку
 *  держат решающие (#433) — иначе кнопку не увидит никто. */
export function RolesSection({
  transition,
  readOnly,
  category = 'task',
}: {
  transition: WorkflowDraftTransition;
  readOnly: boolean;
  category?: ProcessCategory;
}) {
  const patch = usePatchRules(transition);
  const roles = rolesOf(transition.rules);
  const hasDeciders = deciderSourcesOf(transition.rules).length > 0;
  const allowed = WORKFLOW_ROLES_BY_CATEGORY[category];
  return (
    <>
      {allowed.map((role) => (
        <CheckRow
          key={role}
          checked={roles.has(role)}
          disabled={readOnly || (roles.has(role) && roles.size === 1 && !hasDeciders)}
          title={ui.automation.roles[role]}
          onChange={() => patch(toggleRole(transition.rules, role, allowed))}
        />
      ))}
      <p className="text-xs break-words text-muted-foreground">{ui.automation.whoSeesHint}</p>
    </>
  );
}
