import type {
  CustomFieldDefinition,
  CustomFieldType,
  TransitionWindowField,
  TransitionWindowFieldKey,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { customFieldIdOfKey, ui, windowFieldKeys } from '@nodus/contracts';

import { TypeFormulaControl } from '../../../../../shared/custom-fields/formula/type-formula-control.js';
import { sectionOf } from '../../../model/transition-form.js';

/** Тип стандартного поля окна — результат формулы обязан подходить (Р12). */
export const WINDOW_SLOT_TYPES: Readonly<Record<string, CustomFieldType>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  plannedMinutes: 'number',
};

/** Формулы-подстановки полей окна (#632, Р12): у каждого выбранного поля —
 *  конструктор; значение считается при открытии окна. */
export function WindowFieldFormulas({
  form,
  hostKind,
  definitions,
  readOnly,
  onChange,
}: {
  form: WorkflowDraftTransition['form'];
  hostKind: 'task' | 'letter';
  definitions: readonly CustomFieldDefinition[];
  readOnly: boolean;
  onChange: (
    field: TransitionWindowFieldKey,
    ast: import('@nodus/contracts').FormulaNode | null,
  ) => void;
}) {
  const section = sectionOf(form, 'fields');
  const fields = section ? windowFieldKeys(section) : [];
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <p className="text-xs font-medium text-muted-foreground">{ui.formulas.typeFormula.field}</p>
      {fields.map((field) => {
        const id = customFieldIdOfKey(field);
        const definition = id ? definitions.find((entry) => entry.id === id) : undefined;
        if (id && !definition) return null;
        const label = id
          ? definition!.name
          : ui.automation.requirableFields[field as TransitionWindowField];
        return (
          <div key={field} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <TypeFormulaControl
              hostKind={hostKind}
              {...(definition
                ? { definition }
                : { targetType: WINDOW_SLOT_TYPES[field] ?? 'text', label })}
              ownDefinitions={definitions}
              value={section?.formulas?.[field] ?? null}
              readOnly={readOnly}
              allowRelated
              onChange={(ast) => onChange(field, ast)}
            />
          </div>
        );
      })}
    </div>
  );
}
