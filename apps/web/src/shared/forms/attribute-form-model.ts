import type {
  FieldFormElement,
  FieldFormSlot,
  FieldFormState,
  FormulaNode,
  ProjectSystemElement,
  ProjectSystemKey,
} from '@nodus/contracts';
import { isFieldFormSlot, isFormDecor, isProjectSystemElement } from '@nodus/contracts';

import type { BuilderField, BuilderItem, BuilderValue } from './builder/builder-model.js';

/**
 * Форма атрибутов места (вид папки, тип проекта, строка реестра) ↔ редактор
 * окна (#496, единое ядро): слот атрибута и системная строка — обычные поля
 * редактора с подписью, подсказкой, шириной и высотой; оформление — общее.
 * Своё слота (состояние «скрыто / по желанию / обязательно», формула) — в
 * `extra` поля, остальное редактор не читает.
 */

export const ATTRIBUTE_FIELD_PREFIX = 'field:';
export const ATTRIBUTE_SYSTEM_PREFIX = 'system:';

export interface AttributeExtra {
  state?: FieldFormState;
  formula?: FormulaNode;
}

export type AttributeElement = FieldFormElement | ProjectSystemElement;

export function attributeFieldKey(fieldId: string): string {
  return `${ATTRIBUTE_FIELD_PREFIX}${fieldId}`;
}

export function attributeSystemKey(key: ProjectSystemKey): string {
  return `${ATTRIBUTE_SYSTEM_PREFIX}${key}`;
}

export function fieldIdOfAttributeKey(key: string): string | null {
  return key.startsWith(ATTRIBUTE_FIELD_PREFIX) ? key.slice(ATTRIBUTE_FIELD_PREFIX.length) : null;
}

export function systemKeyOfAttributeKey(key: string): string | null {
  return key.startsWith(ATTRIBUTE_SYSTEM_PREFIX) ? key.slice(ATTRIBUTE_SYSTEM_PREFIX.length) : null;
}

export function attributeToBuilder(
  elements: readonly AttributeElement[],
): BuilderValue<AttributeExtra> {
  const items: BuilderItem<AttributeExtra>[] = elements.map((element) => {
    if (isFormDecor(element)) return element;
    if (isProjectSystemElement(element)) {
      return {
        kind: 'field',
        key: attributeSystemKey(element.key),
        label: element.label ?? null,
        hint: null,
        width: element.width ?? 'full',
        ...(element.height ? { height: element.height } : {}),
        extra: {},
      };
    }
    return {
      kind: 'field',
      key: attributeFieldKey(element.fieldId),
      label: element.label ?? null,
      hint: element.hint ?? null,
      width: element.width ?? 'full',
      ...(element.height ? { height: element.height } : {}),
      extra: {
        state: element.state,
        ...(element.formula ? { formula: element.formula } : {}),
      },
    };
  });
  return { items, locks: [] };
}

function slotOf(field: BuilderField<AttributeExtra>): FieldFormSlot {
  const fieldId = fieldIdOfAttributeKey(field.key);
  if (fieldId === null) throw new Error(`not an attribute key: ${field.key}`);
  return {
    fieldId,
    state: field.extra.state ?? 'optional',
    ...(field.extra.formula ? { formula: field.extra.formula } : {}),
    label: field.label,
    ...(field.hint ? { hint: field.hint } : {}),
    ...(field.width === 'half' ? { width: 'half' as const } : {}),
    ...(field.height ? { height: field.height } : {}),
  };
}

function systemOf(field: BuilderField<AttributeExtra>): ProjectSystemElement {
  const key = systemKeyOfAttributeKey(field.key);
  if (key === null) throw new Error(`not a system key: ${field.key}`);
  return {
    kind: 'system',
    key: key as ProjectSystemKey,
    ...(field.label ? { label: field.label } : {}),
    ...(field.width === 'half' ? { width: 'half' as const } : {}),
    ...(field.height ? { height: field.height } : {}),
  };
}

export function attributeFromBuilder(value: BuilderValue<AttributeExtra>): AttributeElement[] {
  return value.items.flatMap((item): AttributeElement[] => {
    if (isFormDecor(item)) return [item];
    if (item.kind !== 'field') return [];
    if (systemKeyOfAttributeKey(item.key) !== null) return [systemOf(item)];
    if (fieldIdOfAttributeKey(item.key) !== null) return [slotOf(item)];
    return [];
  });
}

export function isSlotElement(element: AttributeElement): element is FieldFormSlot {
  return isFieldFormSlot(element);
}
