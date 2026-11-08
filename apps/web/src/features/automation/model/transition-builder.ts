import type {
  FormulaNode,
  TransitionFormSectionDraft,
  TransitionFormSectionKind,
  TransitionWindowElement,
  TransitionWindowFieldKey,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { TRANSITION_FORM_SECTION_ORDER, isFormDecor, windowItems } from '@nodus/contracts';

import type {
  BuilderField,
  BuilderItem,
  BuilderValue,
} from '../../../shared/forms/builder/builder-model.js';
import { defaultWindowSection, sectionOf } from './transition-form.js';
import { setMinFiles, toggleValidator, validatorOf } from './transition-rules.js';

/**
 * Окно кнопки ↔ редактор окна (#496, Р3; вердикт владельца — единый путь):
 * поля раздела «Поля» и разделы окна (трудозатраты, итог, файлы, сообщения,
 * причина, регистрация) — ОБЫЧНЫЕ поля редактора: добавляются через «+»,
 * убираются, настраиваются в настройках поля. Поле без своей раскладки
 * пишется строкой-ключом, как раньше: старое окно туда-обратно не меняется
 * (I-C). Разделы у сотрудника идут после полей в каноне порядка.
 */

type Form = WorkflowDraftTransition['form'];
type Rules = WorkflowDraftTransition['rules'];

const SECTION_PREFIX = 'section:';

export function sectionKey(kind: TransitionFormSectionKind): string {
  return `${SECTION_PREFIX}${kind}`;
}

export function sectionKindOf(key: string): TransitionFormSectionKind | null {
  return key.startsWith(SECTION_PREFIX)
    ? (key.slice(SECTION_PREFIX.length) as TransitionFormSectionKind)
    : null;
}

export interface TransitionExtra {
  formula?: FormulaNode;
  /** Раздел окна (у поля-раздела): его настройки. */
  section?: TransitionFormSectionDraft;
  /** «Обязательно» у трудозатрат и итога — гейт кнопки (Р3). */
  gate?: boolean;
  /** Минимум файлов итога — гейт `result_files`. */
  minFiles?: number;
}

export function transitionField(key: string): BuilderField<TransitionExtra> {
  const kind = sectionKindOf(key);
  return {
    kind: 'field',
    key,
    label: null,
    hint: null,
    width: 'full',
    extra: kind ? { section: defaultWindowSection(kind) } : {},
  };
}

export function transitionToBuilder(form: Form, rules?: Rules): BuilderValue<TransitionExtra> {
  const section = sectionOf(form, 'fields');
  const formulas = section?.formulas ?? {};
  const fields: BuilderItem<TransitionExtra>[] = section
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
    : [];
  const sections = form.sections
    .filter((entry) => entry.kind !== 'fields')
    .map((entry): BuilderField<TransitionExtra> => ({
      kind: 'field',
      key: sectionKey(entry.kind),
      label: null,
      hint: null,
      width: 'full',
      extra: {
        section: entry,
        ...(entry.kind === 'time' && rules ? { gate: !!validatorOf(rules, 'time_logged') } : {}),
        ...(entry.kind === 'result' && rules
          ? { gate: !!validatorOf(rules, 'result_present') }
          : {}),
        ...(entry.kind === 'result_files' && rules
          ? { minFiles: validatorOf(rules, 'result_files')?.min ?? 0 }
          : {}),
      },
    }));
  return { items: [...fields, ...sections], locks: form.locks ?? [] };
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

const isSection = (item: BuilderItem<TransitionExtra>): item is BuilderField<TransitionExtra> =>
  !isFormDecor(item) && sectionKindOf(item.key) !== null;

export function transitionFromBuilder(form: Form, value: BuilderValue<TransitionExtra>): Form {
  const windowElements = value.items.filter((item) => !isSection(item));
  const fields = windowElements.filter(
    (item) => !isFormDecor(item),
  ) as BuilderField<TransitionExtra>[];
  const formulas = Object.fromEntries(
    fields.flatMap((field) => (field.extra.formula ? [[field.key, field.extra.formula]] : [])),
  ) as Record<string, FormulaNode>;
  const sections: TransitionFormSectionDraft[] = value.items
    .filter(isSection)
    .map((item) => item.extra.section ?? defaultWindowSection(sectionKindOf(item.key)!));
  if (fields.length > 0) {
    sections.push({
      kind: 'fields',
      fields: windowElements.map((item) => (isFormDecor(item) ? item : elementOf(item))),
      ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
    });
  }
  sections.sort(
    (a, b) =>
      TRANSITION_FORM_SECTION_ORDER.indexOf(a.kind) - TRANSITION_FORM_SECTION_ORDER.indexOf(b.kind),
  );
  const { locks: _previous, ...rest } = form;
  void _previous;
  return { ...rest, sections, ...(value.locks.length > 0 ? { locks: value.locks } : {}) };
}

/** Гейты разделов (Р3) по итогам редактора: «Обязательно» у трудозатрат и
 *  итога, минимум файлов. Гейт без раздела, поставленный в «Условиях
 *  перехода», не трогается — только разделы, бывшие или ставшие в окне. */
export function rulesFromBuilder(
  rules: Rules,
  before: BuilderValue<TransitionExtra>,
  after: BuilderValue<TransitionExtra>,
): Rules {
  const itemOf = (value: BuilderValue<TransitionExtra>, kind: TransitionFormSectionKind) =>
    value.items.find(
      (item): item is BuilderField<TransitionExtra> =>
        !isFormDecor(item) && item.key === sectionKey(kind),
    );
  let next = rules;
  for (const [gate, kind] of [
    ['time_logged', 'time'],
    ['result_present', 'result'],
  ] as const) {
    if (!itemOf(before, kind) && !itemOf(after, kind)) continue;
    const want = itemOf(after, kind)?.extra.gate === true;
    if ((validatorOf(next, gate) !== undefined) !== want) next = toggleValidator(next, gate);
  }
  if (itemOf(before, 'result_files') || itemOf(after, 'result_files')) {
    next = setMinFiles(next, itemOf(after, 'result_files')?.extra.minFiles ?? 0);
  }
  return next;
}
