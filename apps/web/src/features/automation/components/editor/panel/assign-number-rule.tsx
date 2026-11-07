import type { WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Check } from 'lucide-react';

import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';
import { cn } from '@nodus/ui/lib/utils';
import {
  assignNumberFieldsOf,
  setAssignNumbers,
  type Rules,
} from '../../../model/transition-rules.js';

type PatchRules = (rules: Rules) => void;

/**
 * «Присвоить номер» в особых правилах кнопки задачи (#630, Р4/Р6):
 * тумблер + чек-строка counter-полей типа — одно нажатие кнопки может
 * выдавать номера в несколько полей (К3: «Изм.» + сквозной), по пост-
 * функции на поле. У письма этот блок не показывается (каталог закрыт).
 */
export function AssignNumberRule({
  transition,
  typeId,
  readOnly,
  patch,
}: {
  transition: WorkflowDraftTransition;
  /** Тип процесса: counter-поля «Где используется» этого типа. */
  typeId?: string;
  readOnly: boolean;
  patch: PatchRules;
}) {
  const definitions = useCustomFieldDefinitions('task');
  const counterFields = (definitions.data ?? []).filter(
    (entry) =>
      entry.type === 'counter' &&
      entry.numbering != null &&
      (typeId ? entry.bindings.processTypeIds.includes(typeId) : true),
  );
  const assignFields = assignNumberFieldsOf(transition.rules);
  return (
    <>
      <SwitchRow
        title={ui.automation.postFunctions.assign_number}
        hint={
          counterFields.length === 0
            ? ui.automation.panel.assignNumberNoFields
            : ui.automation.panel.assignNumberHint
        }
        checked={assignFields.length > 0}
        disabled={readOnly || counterFields.length === 0}
        onChange={(checked) =>
          patch(setAssignNumbers(transition.rules, checked ? [counterFields[0]!.id] : []))
        }
      />
      {assignFields.length > 0 ? (
        <PanelField label={ui.automation.panel.assignNumberField}>
          <div className="flex flex-col gap-0.5">
            {counterFields.map((entry) => {
              const checked = assignFields.includes(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={readOnly}
                  onClick={() =>
                    patch(
                      setAssignNumbers(
                        transition.rules,
                        checked
                          ? assignFields.filter((id) => id !== entry.id)
                          : [...assignFields, entry.id],
                      ),
                    )
                  }
                  className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-[5px] border',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background',
                    )}
                  >
                    {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0 truncate">{entry.name}</span>
                </button>
              );
            })}
          </div>
        </PanelField>
      ) : null}
    </>
  );
}
