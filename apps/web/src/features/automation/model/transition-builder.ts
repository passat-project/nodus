import type {
  FormulaNode,
  TransitionFormSectionDraft,
  TransitionWindowElement,
  TransitionWindowFieldKey,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { TRANSITION_FORM_SECTION_ORDER, isFormDecor, windowItems } from '@nodus/contracts';

import type { BuilderField, BuilderValue } from '../../../shared/forms/builder/builder-model.js';
import { sectionOf } from './transition-form.js';

/**
 * Окно кнопки ↔ редактор окна (#496, Р3): раздел «Поля» — элементы
 * редактора, формулы-подстановки (#632) — `extra` поля, замки — замки окна.
 * Поле без своей раскладки пишется строкой-ключом, как раньше: старое окно
 * туда-обратно не меняется (I-C); поле с подписью/подсказкой/шириной/высотой
 * — объектом. Без полей раздел «Поля» снимается (схема требует ≥ 1 поле).
 */

type Form = WorkflowDraftTransition['form'];

export interface TransitionExtra {
  formula?: FormulaNode;
}

export function transitionField(key: string): BuilderField<TransitionExtra> {
  return { kind: 'field', key, label: null, hint: null, width: 'full', extra: {} };
}

export function transitionToBuilder(form: Form): BuilderValue<TransitionExtra> {
  const section = sectionOf(form, 'fields');
  const formulas = section?.formulas ?? {};
  return {
    items: section
      ? windowItems(section).map((element) => {
          if (isFormDecor(element)) return element;
          const formula = formulas[element.key];
          return {
            kind: 'field',
            key: element.key,
            label: element.label ?? null,
            hint: element.hint ?? null,
            width: element.width ?? 'full',
            ...(element.height ? { height: element.height } : {}),
            extra: formula ? { formula } : {},
          };
        })
      : [],
    locks: form.locks ?? [],
  };
}

function elementOf(field: BuilderField<TransitionExtra>): TransitionWindowElement {
  const key = field.key as TransitionWindowFieldKey;
  const plain =
    field.label === null && field.hint === null && field.width !== 'half' && !field.height;
  if (plain) return key;
  return {
    key,
    ...(field.label !== null ? { label: field.label } : {}),
    ...(field.hint !== null ? { hint: field.hint } : {}),
    ...(field.width === 'half' ? { width: 'half' as const } : {}),
    ...(field.height ? { height: field.height } : {}),
  };
}

export function transitionFromBuilder(form: Form, value: BuilderValue<TransitionExtra>): Form {
  const fields = value.items.filter(
    (item) => !isFormDecor(item),
  ) as BuilderField<TransitionExtra>[];
  const formulas = Object.fromEntries(
    fields.flatMap((field) => (field.extra.formula ? [[field.key, field.extra.formula]] : [])),
  ) as Record<string, FormulaNode>;
  const others = form.sections.filter((section) => section.kind !== 'fields');
  const sections: TransitionFormSectionDraft[] =
    fields.length === 0
      ? others
      : [
          ...others,
          {
            kind: 'fields',
            fields: value.items.map((item) => (isFormDecor(item) ? item : elementOf(item))),
            ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
          },
        ];
  sections.sort(
    (a, b) =>
      TRANSITION_FORM_SECTION_ORDER.indexOf(a.kind) - TRANSITION_FORM_SECTION_ORDER.indexOf(b.kind),
  );
  const { locks: _previous, ...rest } = form;
  void _previous;
  return { ...rest, sections, ...(value.locks.length > 0 ? { locks: value.locks } : {}) };
}
