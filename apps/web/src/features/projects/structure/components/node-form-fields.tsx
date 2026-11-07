import type {
  CustomFieldDefinition,
  CustomFieldFormulas,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  NodeKind,
  NodeKindFormField,
} from '@nodus/contracts';
import { effectiveNodeForm, isCustomFieldValueFilled, ui } from '@nodus/contracts';

import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { FormulaCell } from '../../../../shared/custom-fields/formula/formula-cell.js';
import type { FormulaHost } from '../../../../shared/custom-fields/formula/formula-api.js';
import type { FormulaHostContext } from '../../../../shared/custom-fields/formula/formula-editor.js';
import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';
import { FieldRow } from '../../../../shared/ui/entity-fields.js';

/**
 * Поля формы вида папки (#556, ревизия #631): атрибуты слотами — код папки
 * («Код» реестра атрибутов) идёт обычным слотом, спец-поля больше нет.
 * Одна грамматика для окна «Создать папку» и панели «Свойства папки»
 * (правка по месту); «скрыто» в окне создания не показывается, в свойствах
 * — показывается. Обязательные помечены и подсвечиваются, если пусты.
 */

function slotDefinitions(
  kind: NodeKind,
  definitions: readonly CustomFieldDefinition[],
): { slot: NodeKindFormField; definition: CustomFieldDefinition }[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return effectiveNodeForm(kind, definitions).fields.flatMap((slot) => {
    const definition = byId.get(slot.fieldId);
    return definition ? [{ slot, definition }] : [];
  });
}

/** Метка обязательности у метки поля: слово, а не звёздочка-загадка —
 *  состояние «обязательно» читается (вердикт владельца, #556). Точка-разделитель
 *  отделяет метку от названия поля. */
function RequiredMark() {
  return (
    <span className="text-xs font-normal text-muted-foreground">· {ui.structure.requiredMark}</span>
  );
}

/** Окно «Создать папку»: атрибуты формы (скрытые не спрашиваются). */
export function NodeCreateFields({
  kind,
  definitions,
  values,
  refs,
  onChange,
  errors,
}: {
  kind: NodeKind;
  definitions: readonly CustomFieldDefinition[];
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  onChange: (fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) => void;
  /** Id обязательных пустых полей (после ответа 422). */
  errors?: ReadonlySet<string>;
}) {
  const slots = slotDefinitions(kind, definitions).filter(({ slot }) => slot.state !== 'hidden');

  return slots.map(({ slot, definition }) => {
    const required = slot.state === 'required';
    const missing = required && !isCustomFieldValueFilled(values[definition.id]);
    return (
      <div key={definition.id} className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2">
          <CustomFieldTypeIcon
            type={definition.type}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="text-label text-muted-foreground">{definition.name}</span>
          {required ? <RequiredMark /> : null}
        </span>
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
      </div>
    );
  });
}

/** Панель «Свойства папки»: те же слоты формы, включая «скрыто» (Р6). */
export function NodePanelFields({
  kind,
  definitions,
  values,
  refs,
  disabled,
  onChange,
  host,
  hostContext,
  formulas,
}: {
  kind: NodeKind;
  definitions: readonly CustomFieldDefinition[];
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  disabled: boolean;
  onChange: (fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) => void;
  /** Папка-носитель формул (#632); без неё — обычная правка значений. */
  host?: FormulaHost;
  hostContext?: FormulaHostContext;
  formulas?: CustomFieldFormulas;
}) {
  const slots = slotDefinitions(kind, definitions);

  return (
    <div className="flex flex-col">
      {slots.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          {ui.structure.propertiesAttributesEmpty}
        </p>
      ) : (
        slots.map(({ slot, definition }) => (
          <FieldRow
            key={definition.id}
            stacked
            icon={<CustomFieldTypeIcon type={definition.type} className="size-3.5" />}
            label={definition.name}
            hint={definition.hint}
            required={slot.state === 'required'}
            requiredText={ui.structure.requiredMark}
            wide={definition.type === 'long_text'}
          >
            {host ? (
              <FormulaCell
                definition={definition}
                host={host}
                hostContext={hostContext ?? {}}
                info={formulas?.[definition.id]}
                value={values[definition.id]}
                refs={refs}
                canEdit={!disabled}
                ownDefinitions={slots.map((entry) => entry.definition)}
              >
                <CustomFieldEditor
                  definition={definition}
                  value={values[definition.id]}
                  refs={refs}
                  disabled={disabled}
                  variant="inline"
                  onCommit={(value, picked) => onChange(definition.id, value, picked)}
                />
              </FormulaCell>
            ) : (
              <CustomFieldEditor
                definition={definition}
                value={values[definition.id]}
                refs={refs}
                disabled={disabled}
                variant="inline"
                onCommit={(value, picked) => onChange(definition.id, value, picked)}
              />
            )}
          </FieldRow>
        ))
      )}
    </div>
  );
}
