import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  NodeKind,
  NodeKindFormField,
} from '@nodus/contracts';
import { effectiveNodeForm, isCustomFieldValueFilled, NODE_LIMITS, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { CustomFieldTypeIcon } from '../../../../shared/custom-fields/field-type-icon.js';
import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';
import { FieldRow } from '../../../../shared/ui/entity-fields.js';

/**
 * Поля формы вида папки (#556, Р6): системный «Шифр» по состоянию формы и
 * атрибуты слотами. Одна грамматика для окна «Создать папку» (постоянные
 * контролы) и панели «Свойства папки» (правка по месту); «скрыто» в окне
 * создания не показывается, в свойствах — показывается. Обязательные
 * помечены и подсвечиваются, если пусты.
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

/** Окно «Создать папку»: шифр и атрибуты формы (скрытые не спрашиваются). */
export function NodeCreateFields({
  kind,
  definitions,
  code,
  onCode,
  values,
  refs,
  onChange,
  errors,
}: {
  kind: NodeKind;
  definitions: readonly CustomFieldDefinition[];
  code: string;
  onCode: (value: string) => void;
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  onChange: (fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) => void;
  /** Ключи обязательных пустых полей (после ответа 422). */
  errors?: ReadonlySet<string>;
}) {
  const form = effectiveNodeForm(kind, definitions);
  const slots = slotDefinitions(kind, definitions).filter(({ slot }) => slot.state !== 'hidden');
  const codeRequired = form.code === 'required';

  return (
    <>
      {form.code === 'hidden' ? null : (
        <label className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <NodeLabel label={ui.structure.nodeCode} />
            {codeRequired ? <RequiredMark /> : null}
          </span>
          <Input
            value={code}
            maxLength={NODE_LIMITS.codeLength}
            aria-invalid={errors?.has('code') || undefined}
            aria-required={codeRequired || undefined}
            onChange={(event) => onCode(event.target.value)}
            className={cn(errors?.has('code') && 'border-danger')}
          />
        </label>
      )}
      {slots.map(({ slot, definition }) => {
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
      })}
    </>
  );
}

/** Панель «Свойства папки»: те же слоты формы, включая «скрыто» (Р6). */
export function NodePanelFields({
  kind,
  definitions,
  code,
  onCode,
  values,
  refs,
  disabled,
  onChange,
}: {
  kind: NodeKind;
  definitions: readonly CustomFieldDefinition[];
  code: string;
  onCode: (value: string) => void;
  values: CustomFieldValues;
  refs: readonly CustomFieldRef[];
  disabled: boolean;
  onChange: (fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) => void;
}) {
  const form = effectiveNodeForm(kind, definitions);
  const slots = slotDefinitions(kind, definitions);

  return (
    <div className="flex flex-col">
      {form.code === 'hidden' ? null : (
        <FieldRow
          stacked
          icon={<CustomFieldTypeIcon type="text" className="size-3.5" />}
          label={ui.structure.nodeCode}
          required={form.code === 'required'}
          requiredText={ui.structure.requiredMark}
        >
          <Input
            value={code}
            maxLength={NODE_LIMITS.codeLength}
            disabled={disabled}
            aria-label={ui.structure.nodeCode}
            onChange={(event) => onCode(event.target.value)}
            className="h-7 text-sm"
          />
        </FieldRow>
      )}
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
            <CustomFieldEditor
              definition={definition}
              value={values[definition.id]}
              refs={refs}
              disabled={disabled}
              variant="inline"
              onCommit={(value, picked) => onChange(definition.id, value, picked)}
            />
          </FieldRow>
        ))
      )}
    </div>
  );
}
