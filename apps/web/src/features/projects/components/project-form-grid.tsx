import type { ReactNode } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  ProjectType,
  ProjectSystemKey,
} from '@nodus/contracts';
import {
  effectiveProjectTypeForm,
  formFieldWidth,
  isCustomFieldValueFilled,
  isFormDecor,
  isProjectSystemElement,
  ui,
} from '@nodus/contracts';

import { CustomFieldEditor } from '../../../shared/custom-fields/value-editor.js';
import {
  FormDecorView,
  FormFieldShell,
  FormGrid,
  type FormGridItem,
} from '../../../shared/forms/form-grid.js';

/**
 * Окно проекта на общей сетке (#496, Р2): атрибуты формы типа, системные
 * строки и оформление — в порядке редактора окна. Подпись, подсказка, ширина
 * и высота — из формы типа; «скрытые» слоты не показываются. Контролы
 * системных строк даёт вызывающий (создание и правка знают свои права).
 */
export function ProjectFormGrid({
  type,
  definitions,
  values,
  refs,
  errors,
  onChange,
  systemLabel,
  renderSystem,
}: {
  type: ProjectType | null;
  definitions: readonly CustomFieldDefinition[];
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  errors?: ReadonlySet<string>;
  onChange: (fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) => void;
  systemLabel?: (key: ProjectSystemKey) => string;
  /** Контрол системной строки; null — не показывать. */
  renderSystem: (key: ProjectSystemKey) => ReactNode | null;
}) {
  if (!type) return null;
  const form = effectiveProjectTypeForm(type, definitions);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const items = form.fields.flatMap((element): FormGridItem[] => {
    if (isFormDecor(element)) {
      return [{ id: element.id, width: 'full', node: <FormDecorView decor={element} /> }];
    }
    if (isProjectSystemElement(element)) {
      const control = renderSystem(element.key);
      if (control === null) return [];
      return [
        {
          id: `system:${element.key}`,
          width: element.width ?? 'full',
          node: (
            <FormFieldShell
              label={element.label ?? systemLabel?.(element.key) ?? element.key}
              height={element.key === 'description' ? (element.height ?? 'lines') : undefined}
            >
              {control}
            </FormFieldShell>
          ),
        },
      ];
    }
    const definition = byId.get(element.fieldId);
    if (!definition || element.state === 'hidden') return [];
    const required = element.state === 'required';
    const missing = required && !isCustomFieldValueFilled(values[definition.id]);
    return [
      {
        id: definition.id,
        width: formFieldWidth(element),
        node: (
          <FormFieldShell
            label={element.label ?? definition.name}
            required={required}
            hint={element.hint ?? definition.hint}
            height={definition.type === 'long_text' ? (element.height ?? 'lines') : undefined}
          >
            <CustomFieldEditor
              definition={definition}
              value={values[definition.id]}
              refs={refs}
              variant="form"
              onCommit={(value, picked) => onChange(definition.id, value, picked)}
            />
            {missing && errors?.has(definition.id) ? (
              <span className="text-xs text-danger">{ui.structure.requiredEmpty}</span>
            ) : null}
          </FormFieldShell>
        ),
      },
    ];
  });
  return items.length === 0 ? null : <FormGrid items={items} />;
}

export const PROJECT_SYSTEM_LABELS: Readonly<Record<ProjectSystemKey, string>> = {
  manager: ui.projects.manager,
  assistants: ui.projects.assistants,
  observers: ui.projects.observers,
  portfolio: ui.projects.filterPortfolio,
  visibility: ui.projects.fieldVisibility,
  endDate: ui.projects.deadline,
  description: ui.projects.fieldDescription,
};
