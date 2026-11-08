import type {
  CustomFieldType,
  FormulaNode,
  TransitionFormSectionDraft,
  TransitionFormSectionKind,
  TransitionWindowElement,
  TransitionWindowFieldKey,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { isFormDecor, windowItems } from '@nodus/contracts';

import type {
  BuilderBlock,
  BuilderField,
  BuilderItem,
  BuilderValue,
} from '../../../shared/forms/builder/builder-model.js';
import { defaultWindowSection, sectionOf } from './transition-form.js';
import { setMinFiles, toggleValidator, validatorOf } from './transition-rules.js';

/**
 * Окно кнопки ↔ редактор окна (#496, единое ядро). Поля раздела «Поля» —
 * обычные поля редактора; трудозатраты, итог, файлы, сообщения, причина и
 * регистрация — обычные БЛОКИ редактора: та же подпись, подсказка, настройки
 * и место. Поле без своей раскладки пишется строкой-ключом, как раньше:
 * старое окно туда-обратно не меняется (I-C).
 */

type Form = WorkflowDraftTransition['form'];
type Rules = WorkflowDraftTransition['rules'];

/** Тип стандартного поля окна — результат формулы обязан подходить (Р12). */
export const WINDOW_SLOT_TYPES: Readonly<Record<string, CustomFieldType>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  plannedMinutes: 'number',
};

/** Своё поля и блока: у поля — формула, у блока — параметры его раздела. */
export interface TransitionExtra {
  formula?: FormulaNode;
  mode?: 'if_empty' | 'always';
  /** «Обязательно» у трудозатрат и итога — гейт кнопки (Р3). */
  gate?: boolean;
  /** Минимум файлов итога — гейт `result_files`. */
  minFiles?: number;
  /** Обязательность раздела с собственным флагом (сообщения, причина). */
  required?: boolean;
}

export function transitionField(key: string): BuilderField<TransitionExtra> {
  return {
    kind: 'field',
    key,
    label: null,
    hint: null,
    width: 'full',
    extra: {},
  };
}

/** Блок окна по умолчанию: те же значения, что у прежнего раздела. */
export function transitionBlock(kind: TransitionFormSectionKind): BuilderBlock<TransitionExtra> {
  return {
    kind: 'block',
    block: kind,
    label: null,
    hint: null,
    extra: blockExtra(defaultWindowSection(kind)),
  };
}

function blockExtra(section: TransitionFormSectionDraft): TransitionExtra {
  switch (section.kind) {
    case 'time':
      return { mode: section.mode };
    case 'result_files':
      return { minFiles: 0 };
    case 'result_messages':
    case 'comment':
      return { required: section.required };
    default:
      return {};
  }
}

function sectionOfBlock(block: BuilderBlock<TransitionExtra>): TransitionFormSectionDraft {
  const kind = block.block as TransitionFormSectionKind;
  const base = defaultWindowSection(kind);
  const label = block.label ?? undefined;
  const hint = block.hint ?? undefined;
  switch (base.kind) {
    case 'time':
      return {
        kind: 'time',
        mode: block.extra.mode ?? base.mode,
        ...(label ? { label } : {}),
        ...(hint ? { hint } : {}),
      };
    case 'result':
    case 'registration':
      return { kind: base.kind, ...(label ? { label } : {}), ...(hint ? { hint } : {}) };
    case 'result_files':
      return { kind: 'result_files', ...(label ? { label } : {}), ...(hint ? { hint } : {}) };
    case 'result_messages':
      return {
        kind: 'result_messages',
        required: block.extra.required ?? false,
        ...(label ? { label } : {}),
        ...(hint ? { hint } : {}),
      };
    case 'comment':
      return {
        kind: 'comment',
        required: block.extra.required ?? base.required,
        ...(label ? { label } : {}),
        ...(hint ? { hint } : {}),
      };
    case 'fields':
      return base;
  }
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
  const blocks = form.sections
    .filter((entry) => entry.kind !== 'fields')
    .map((entry): BuilderBlock<TransitionExtra> => ({
      kind: 'block',
      block: entry.kind,
      label: entry.label ?? null,
      hint: entry.hint ?? null,
      extra: {
        ...blockExtra(entry),
        ...(entry.kind === 'time' && rules ? { gate: !!validatorOf(rules, 'time_logged') } : {}),
        ...(entry.kind === 'result' && rules
          ? { gate: !!validatorOf(rules, 'result_present') }
          : {}),
        ...(entry.kind === 'result_files' && rules
          ? { minFiles: validatorOf(rules, 'result_files')?.min ?? 0 }
          : {}),
      },
    }));
  return { items: [...fields, ...blocks], locks: form.locks ?? [] };
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
  const fieldElements: TransitionWindowElement[] = [];
  const blocks: BuilderBlock<TransitionExtra>[] = [];
  for (const item of value.items) {
    if (isFormDecor(item)) {
      if (blocks.length === 0) fieldElements.push(item);
      continue;
    }
    if (item.kind === 'block') {
      blocks.push(item);
      continue;
    }
    if (blocks.length === 0) fieldElements.push(elementOf(item));
  }
  const formulas = Object.fromEntries(
    value.items.flatMap((item) =>
      item.kind === 'field' && item.extra.formula ? [[item.key, item.extra.formula]] : [],
    ),
  ) as Record<string, FormulaNode>;
  const sections: TransitionFormSectionDraft[] = [
    ...(fieldElements.length > 0
      ? [
          {
            kind: 'fields' as const,
            fields: fieldElements,
            ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
          },
        ]
      : []),
    ...blocks.map(sectionOfBlock),
  ];
  const { locks: _previous, ...rest } = form;
  void _previous;
  return { ...rest, sections, ...(value.locks.length > 0 ? { locks: value.locks } : {}) };
}

/** Гейты блоков (Р3) по итогам редактора: «Обязательно» у трудозатрат и
 *  итога, минимум файлов. Гейт без блока, поставленный в «Условиях
 *  перехода», не трогается — только блоки, бывшие или ставшие в окне. */
export function rulesFromBuilder(
  rules: Rules,
  before: BuilderValue<TransitionExtra>,
  after: BuilderValue<TransitionExtra>,
): Rules {
  const blockOf = (value: BuilderValue<TransitionExtra>, kind: TransitionFormSectionKind) =>
    value.items.find(
      (item): item is BuilderBlock<TransitionExtra> => item.kind === 'block' && item.block === kind,
    );
  let next = rules;
  for (const [gate, kind] of [
    ['time_logged', 'time'],
    ['result_present', 'result'],
  ] as const) {
    if (!blockOf(before, kind) && !blockOf(after, kind)) continue;
    const want = blockOf(after, kind)?.extra.gate === true;
    if ((validatorOf(next, gate) !== undefined) !== want) next = toggleValidator(next, gate);
  }
  if (blockOf(before, 'result_files') || blockOf(after, 'result_files')) {
    next = setMinFiles(next, blockOf(after, 'result_files')?.extra.minFiles ?? 0);
  }
  return next;
}
