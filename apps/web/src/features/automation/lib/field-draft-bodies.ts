import type {
  CreateCustomFieldBody,
  CustomFieldDefault,
  CustomFieldDefinition,
  CustomFieldSettings,
  CustomFieldType,
  UpdateCustomFieldBody,
} from '@nodus/contracts';

import { onCreateOf } from './counter-draft.js';
import { draftType, type FieldDraft } from './field-draft.js';

/** Тела API окна атрибута (#431, ревизия #631/#630): создание и правка из
 *  черновика — только изменённые ключи. Вынесено из field-draft.ts (I5). */

/** Умолчание не-списка: режим «Нет» сбрасывает выбранное значение. */
export function scalarDefault(draft: FieldDraft): CustomFieldDefault | null {
  return draft.defaultMode === 'none' ? null : draft.defaultValue;
}

/** Умолчание списка из отмеченных вариантов (временные id → серверные). */
export function listDefault(
  draft: FieldDraft,
  type: CustomFieldType,
  ids: ReadonlyMap<string, string>,
): CustomFieldDefault | null {
  const kept = new Set(draft.options.map((option) => option.id));
  const picked = draft.defaultOptionIds.filter((id) => kept.has(id)).map((id) => ids.get(id) ?? id);
  if (picked.length === 0) return null;
  return { kind: 'static', value: type === 'multienum' ? picked : picked[0]! };
}

function settingsOf(draft: FieldDraft, type: CustomFieldType): CustomFieldSettings {
  if (type === 'number') return { precision: draft.settings.precision ?? 0 };
  if (type === 'money') return { currencyId: draft.settings.currencyId ?? null };
  return {};
}

export function createBody(
  draft: FieldDraft,
  extra: { dictionaryId?: string; defaultValue?: CustomFieldDefault | null },
): CreateCustomFieldBody {
  const type = draftType(draft)!;
  const hint = draft.hint.trim();
  return {
    type,
    name: draft.name.trim(),
    ...(hint ? { hint } : {}),
    settings: extra.dictionaryId ? { dictionaryId: extra.dictionaryId } : settingsOf(draft, type),
    defaultValue: extra.defaultValue !== undefined ? extra.defaultValue : scalarDefault(draft),
    reportIndexed: draft.reportIndexed,
    isCompany: draft.isCompany,
    ...(draft.isCompany
      ? {}
      : {
          bindings: draft.bindings,
          ...(type === 'counter' ? {} : { bindingFormulas: draft.bindingFormulas }),
        }),
    ...(type === 'counter'
      ? { numbering: draft.numbering, numberingOnCreate: onCreateOf(draft) }
      : {}),
    ...(type === 'counter' &&
    draft.numbering.containers.length === 0 &&
    draft.numberingNext !== null
      ? { numberingNext: draft.numberingNext }
      : {}),
  };
}

/** Тело правки — только изменённые ключи (null — правок нет). */
export function patchBody(
  definition: CustomFieldDefinition,
  draft: FieldDraft,
  defaultValue: CustomFieldDefault | null,
): UpdateCustomFieldBody | null {
  const type = draftType(draft)!;
  const body: UpdateCustomFieldBody = {};
  const name = draft.name.trim();
  const hint = draft.hint.trim() || null;
  if (name !== definition.name) body.name = name;
  if (hint !== definition.hint) body.hint = hint;
  if (type !== definition.type) body.type = type;
  if (type === 'number' && (draft.settings.precision ?? 0) !== (definition.settings.precision ?? 0))
    body.settings = { precision: draft.settings.precision ?? 0 };
  if (type === 'money' && draft.settings.currencyId !== definition.settings.currencyId)
    body.settings = { currencyId: draft.settings.currencyId ?? null };
  if (JSON.stringify(defaultValue) !== JSON.stringify(definition.defaultValue))
    body.defaultValue = defaultValue;
  if (
    !definition.isCompany &&
    JSON.stringify(draft.bindings) !== JSON.stringify(definition.bindings)
  )
    body.bindings = draft.bindings;
  if (draft.reportIndexed !== definition.reportIndexed) body.reportIndexed = draft.reportIndexed;
  if (
    type !== 'counter' &&
    !definition.isCompany &&
    JSON.stringify(draft.bindingFormulas) !== JSON.stringify(definition.bindingFormulas ?? {})
  )
    body.bindingFormulas = draft.bindingFormulas;
  if (
    type === 'counter' &&
    JSON.stringify(draft.numbering) !== JSON.stringify(definition.numbering?.rule ?? null)
  )
    body.numbering = draft.numbering;
  const onCreate = onCreateOf(draft);
  if (
    type === 'counter' &&
    JSON.stringify([...onCreate].sort()) !==
      JSON.stringify([...(definition.numbering?.onCreate ?? [])].sort())
  )
    body.numberingOnCreate = onCreate;
  return Object.keys(body).length > 0 ? body : null;
}
