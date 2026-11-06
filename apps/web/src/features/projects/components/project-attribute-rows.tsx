import { Fragment } from 'react';
import type {
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  ProjectType,
} from '@nodus/contracts';
import { projectTypeFormOf } from '@nodus/contracts';

import { CustomFieldTypeIcon } from '../../../shared/custom-fields/field-type-icon.js';
import { definitionsForTarget } from '../../../shared/custom-fields/module-target.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { CustomFieldEditor } from '../../../shared/custom-fields/value-editor.js';

/** Звёздочка обязательного поля — тон действия, прижата к метке (как у
 *  системных полей окон проекта). */
function RequiredMark() {
  return (
    <span aria-hidden className="text-primary">
      *
    </span>
  );
}

/**
 * Строки атрибутов слотов формы типа проекта (#631, Р10): дети сетки окон
 * создания/правки («метка слева — контрол справа»), скрытые слоты не
 * спрашиваются, обязательные — со звёздочкой (кнопку окна блокирует
 * `missingProjectFields` у вызывающего). Показываются атрибуты,
 * привязанные к выбранному типу; многострочный текст — на всю ширину окна.
 */
export function ProjectAttributeRows({
  type,
  values,
  refs,
  onChange,
}: {
  type: ProjectType | null;
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  onChange: (fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) => void;
}) {
  const query = useCustomFieldDefinitions('project');
  const form = projectTypeFormOf(type ?? {});
  const definitions = definitionsForTarget(query.data, 'project', type?.id);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const slots = form.fields.flatMap((slot) => {
    if (slot.state === 'hidden') return [];
    const definition = byId.get(slot.fieldId);
    return definition ? [{ slot, definition }] : [];
  });
  if (slots.length === 0) return null;

  return (
    <>
      {slots.map(({ slot, definition }) => {
        const required = slot.state === 'required';
        const label = (
          <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            <CustomFieldTypeIcon
              type={definition.type}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate" title={definition.name}>
              {definition.name}
            </span>
            {required ? <RequiredMark /> : null}
          </span>
        );
        const editor = (
          <CustomFieldEditor
            definition={definition}
            value={values[definition.id]}
            refs={refs}
            variant="form"
            onCommit={(value, picked) => onChange(definition.id, value, picked)}
          />
        );
        return definition.type === 'long_text' ? (
          <div key={definition.id} className="col-span-2 flex flex-col gap-1.5">
            {label}
            {editor}
          </div>
        ) : (
          <Fragment key={definition.id}>
            {label}
            {editor}
          </Fragment>
        );
      })}
    </>
  );
}
