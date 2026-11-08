import { useMemo } from 'react';
import type {
  CreationFieldKey,
  CreationForm,
  CustomFieldDefinition,
  ProcessType,
  RoleLabels,
} from '@nodus/contracts';
import { customFieldIdOfKey, slotLabel, typeConfigOf, ui, creationSlots } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { isWide, SlotControl } from './task-create-fields.js';

/**
 * Низ окна создания (#432, Р9): поля эффективной формы выбранного типа —
 * системные и атрибуты типа, в порядке формы. Скрытые поля (со значением,
 * которое ставит система) сотруднику НЕ показываются. Подпись — своё
 * название слота, иначе название роли из настроек типа, иначе стандартное
 * (Р3). Поле с ошибкой 422 подсвечено; обязательное помечено звёздочкой —
 * `leading-none`, чтобы звёздочка не раздувала строку подписи и низ не
 * прыгал при смене типа.
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
  const visible = creationSlots(form).filter((slot) => slot.preset === null);

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{ui.taskCreate.noFields}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {visible.map((slot) => {
        const fieldId = customFieldIdOfKey(slot.key);
        const definition = fieldId ? byId.get(fieldId) : undefined;
        const label = slotLabel(slot, { roleLabels, definitions });
        const wide = isWide(slot, definition);
        return (
          <div
            key={slot.key}
            className={cn(
              'min-w-0',
              wide ? 'flex flex-col gap-1.5' : 'grid grid-cols-[8rem_1fr] items-center gap-x-3',
            )}
          >
            <div className="flex min-w-0 items-center gap-1">
              <NodeLabel label={label} className="min-w-0" />
              {slot.required ? (
                <span aria-hidden className="text-label leading-none text-danger">
                  *
                </span>
              ) : null}
              {slot.required ? <span className="sr-only">{ui.taskCreate.requiredMark}</span> : null}
            </div>
            <div className="min-w-0">
              <SlotControl
                slot={slot}
                definition={definition}
                value={values[slot.key]}
                invalid={invalidKeys?.has(slot.key) ?? false}
                label={label}
                onChange={(value) => onChange(slot.key, value)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
