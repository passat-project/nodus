import { useMemo } from 'react';
import type {
  CreationFieldKey,
  CreationFieldSlot,
  CreationForm,
  CustomFieldDefinition,
  FormHeight,
  ProcessType,
  RoleLabels,
} from '@nodus/contracts';
import {
  customFieldIdOfKey,
  formFieldWidth,
  isFormDecor,
  slotLabel,
  typeConfigOf,
  ui,
} from '@nodus/contracts';

import { FormDecorView, FormFieldShell, FormGrid, type FormGridItem } from '../forms/form-grid.js';
import { WillLockNotice } from '../forms/lock-notice.js';
import { SlotControl } from './task-create-fields.js';

/** Высота многострочного поля (#496, Р1): описание и длинный текст. */
function heightOf(
  slot: CreationFieldSlot,
  definition: CustomFieldDefinition | undefined,
): FormHeight | undefined {
  const multiline = slot.key === 'description' || definition?.type === 'long_text';
  return multiline ? (slot.height ?? 'lines') : undefined;
}

/**
 * Низ окна создания (#432, Р9; #496, Р2/Р14): поля и оформление эффективной
 * формы типа на общей сетке окна — подпись сверху, две половины рядом,
 * подсказка под полем. Скрытые поля (значение ставит система) сотруднику НЕ
 * показываются, как и поле удалённого атрибута. Подпись — своё название
 * слота, иначе название роли из настроек типа, иначе стандартное (Р3). Поле,
 * которое закрепит окно, помечено заранее: «Закрепится после создания».
 */
export function TaskCreateFormBody({
  type,
  form,
  values,
  onChange,
  definitions,
  invalidKeys,
}: {
  type: ProcessType | null;
  form: CreationForm;
  values: Readonly<Record<string, unknown>>;
  onChange: (key: CreationFieldKey, value: unknown) => void;
  definitions: readonly CustomFieldDefinition[];
  invalidKeys?: ReadonlySet<string>;
}) {
  const roleLabels: RoleLabels = type ? typeConfigOf(type).card.roleLabels : {};
  const byId = useMemo(
    () => new Map(definitions.map((definition) => [definition.id, definition])),
    [definitions],
  );
  const locked = new Set((form.locks ?? []).map((lock) => lock.key));

  let fieldsShown = 0;
  const items = form.fields.flatMap((element): FormGridItem[] => {
    if (isFormDecor(element)) {
      return [{ id: element.id, width: 'full', node: <FormDecorView decor={element} /> }];
    }
    if (element.preset !== null) return [];
    const fieldId = customFieldIdOfKey(element.key);
    const definition = fieldId ? byId.get(fieldId) : undefined;
    if (fieldId && !definition) return [];
    fieldsShown += 1;
    const label = slotLabel(element, { roleLabels, definitions });
    return [
      {
        id: element.key,
        width: formFieldWidth(element),
        node: (
          <FormFieldShell
            label={label}
            required={element.required}
            hint={element.hint}
            height={heightOf(element, definition)}
            notice={
              locked.has(element.key) ? (
                <WillLockNotice text={ui.forms.locks.willLockCreation} />
              ) : null
            }
          >
            <SlotControl
              slot={element}
              definition={definition}
              value={values[element.key]}
              invalid={invalidKeys?.has(element.key) ?? false}
              label={label}
              onChange={(value) => onChange(element.key, value)}
            />
          </FormFieldShell>
        ),
      },
    ];
  });

  if (fieldsShown === 0) {
    return <p className="text-sm text-muted-foreground">{ui.taskCreate.noFields}</p>;
  }
  return <FormGrid items={items} />;
}
