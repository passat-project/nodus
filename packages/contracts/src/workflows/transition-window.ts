import type { FormulaNode } from '../custom-fields/formula.js';
import type {
  TransitionForm,
  TransitionFormSectionKind,
  TransitionWindowFieldKey,
  TransitionWindowItem,
} from './transition-form.schemas.js';
import {
  TRANSITION_FORM_SECTION_ORDER,
  windowFieldKeys,
  windowItems,
} from './transition-form.schemas.js';
import type { TransitionBlockReason, WorkflowTransitionRules } from './workflow.schemas.js';

/**
 * Эффективное окно перехода (#380, Р4 плана): разделы настройки кнопки ∪
 * разделы, выводимые из гейтов. Одна чистая грамматика для веба (что
 * показать) и сервера (что разрешено в теле) — заблокированная кнопка,
 * которую окно может разблокировать, открывает окно даже без настройки.
 * Исключение из «без логики в contracts» (patterns.md): грамматика обязана
 * совпадать байт-в-байт.
 */

/** Подпись и подсказка блока окна: те же настройки, что у поля (#496). */
export interface EffectiveSectionLayout {
  /** Своё название блока в этом окне; пусто — стандартное (i18n). */
  label?: string;
  hint?: string | null;
}

/** Раздел эффективного окна: `origin` — настройка кнопки или гейт (веб
 *  показывает подпись по умолчанию для гейтового раздела). */
export type EffectiveSection =
  | ({ kind: 'registration'; origin: 'form' | 'gate' } & EffectiveSectionLayout)
  | {
      kind: 'fields';
      hint?: string | null;
      /** Ключи полей окна: настроенные + добавленные гейтом (сверка ввода). */
      fields: TransitionWindowFieldKey[];
      /** Порядок окна (#496, Р3): поля-объекты и оформление настроенного
       *  раздела, затем поля, которые добавил только гейт (`{ key }`). */
      elements: TransitionWindowItem[];
      /** Ключи, которых нет в настроенном разделе — их добавило условие
       *  «Заполнены поля» (редактор: «из условия перехода»; сервер: пишутся
       *  в закреплённое, только пока пусты, Р4). */
      gateKeys: TransitionWindowFieldKey[];
      /** Формулы-подстановки слотов (#632, Р12): веб применяет префилл и
       *  всегда отправляет такой слот, чтобы снимок сохранился. */
      formulas?: Record<string, FormulaNode>;
      origin: 'form' | 'gate';
    }
  | ({
      kind: 'time';
      mode: 'if_empty' | 'always';
      origin: 'form' | 'gate';
    } & EffectiveSectionLayout)
  | ({ kind: 'result'; origin: 'form' | 'gate' } & EffectiveSectionLayout)
  | ({
      kind: 'result_files';
      label: string;
      origin: 'form' | 'gate';
    } & EffectiveSectionLayout)
  | ({
      kind: 'result_messages';
      required: boolean;
      origin: 'form' | 'gate';
    } & EffectiveSectionLayout)
  | ({
      kind: 'comment';
      label: string;
      required: boolean;
      origin: 'form' | 'gate';
    } & EffectiveSectionLayout);

export function effectiveWindowSections(
  form: TransitionForm | null,
  rules: Pick<WorkflowTransitionRules, 'validators'>,
): EffectiveSection[] {
  const sections = new Map<TransitionFormSectionKind, EffectiveSection>();
  const ordered: EffectiveSection[] = [];
  if (form?.enabled) {
    for (const section of form.sections) {
      if (sections.has(section.kind)) continue;
      const effective: EffectiveSection =
        section.kind === 'fields'
          ? {
              kind: 'fields',
              fields: windowFieldKeys(section),
              elements: windowItems(section),
              gateKeys: [],
              ...(section.formulas ? { formulas: section.formulas } : {}),
              origin: 'form',
            }
          : section.kind === 'result_files'
            ? { ...section, label: section.label ?? '', origin: 'form' }
            : section.kind === 'comment'
              ? { ...section, label: section.label ?? '', origin: 'form' }
              : { ...section, origin: 'form' };
      sections.set(section.kind, effective);
      ordered.push(effective);
    }
  }

  const gateFields = new Set<TransitionWindowFieldKey>();
  let gateResult = false;
  let gateTime = false;
  let gateFiles = false;
  for (const validator of rules.validators) {
    switch (validator.kind) {
      case 'fields_required':
        for (const field of validator.fields) {
          if (field === 'result') gateResult = true;
          else gateFields.add(field);
        }
        break;
      case 'result_present':
        gateResult = true;
        break;
      case 'time_logged':
        gateTime = true;
        break;
      case 'result_files':
        gateFiles = true;
        break;
    }
  }

  if (gateFields.size > 0) {
    const existing = sections.get('fields');
    const configured = existing?.kind === 'fields' ? existing.fields : [];
    const gateKeys = [...gateFields].filter((field) => !configured.includes(field));
    sections.set('fields', {
      kind: 'fields',
      fields: [...configured, ...gateKeys],
      elements: [
        ...(existing?.kind === 'fields' ? existing.elements : []),
        ...gateKeys.map((key) => ({ key })),
      ],
      gateKeys,
      ...(existing?.kind === 'fields' && existing.formulas ? { formulas: existing.formulas } : {}),
      origin: existing ? 'form' : 'gate',
    });
  }
  if (gateTime && !sections.has('time')) {
    sections.set('time', { kind: 'time', mode: 'if_empty', origin: 'gate' });
  }
  if (gateResult && !sections.has('result')) {
    sections.set('result', { kind: 'result', origin: 'gate' });
  }
  if (gateFiles && !sections.has('result_files')) {
    // Подпись гейтового раздела даёт веб из i18n; сервер подпись не читает.
    sections.set('result_files', { kind: 'result_files', label: '', origin: 'gate' });
  }

  // Порядок окна (#496): настроенные блоки идут в порядке редактора, а не
  // канона — сотрудник видит ровно тот порядок, что собрал администратор.
  // «Регистрация» письма всегда первой (ввод номера), блоки из одних гейтов
  // добавляются после настроенных в каноническом порядке.
  const configured = ordered.map((section) => section.kind);
  const configuredSet = new Set(configured);
  const head = configured.filter((kind) => kind === 'registration');
  const tail = configured.filter((kind) => kind !== 'registration');
  const gateOnly = TRANSITION_FORM_SECTION_ORDER.filter(
    (kind) => !configuredSet.has(kind) && sections.has(kind),
  );
  return [...head, ...tail, ...gateOnly].flatMap((kind) => {
    const section = sections.get(kind);
    return section ? [section] : [];
  });
}

/** Может ли окно исправить причину блокировки (маршрутизация кнопки в вебе). */
export function gateFixableBy(
  kind: TransitionBlockReason['kind'],
): 'fields' | 'time' | 'result' | 'result_files' | null {
  switch (kind) {
    case 'fields_required':
      return 'fields';
    case 'time_logged':
      return 'time';
    case 'result_present':
      return 'result';
    case 'result_files':
      return 'result_files';
    case 'no_open_subtasks':
    case 'checklist_complete':
    case 'decider_vacant':
      // Вакансия решающего (#433): окно не чинит — нужен обход с причиной.
      return null;
  }
}

/** Есть ли в окне раздел, без которого переход невозможен (DnD/API без формы).
 *  Регистрация письма обязательна всегда: без ввода номер не присвоить (#55). */
export function requiredWindowSections(sections: readonly EffectiveSection[]): string[] {
  return sections.flatMap((section) => {
    if (section.kind === 'registration') return ['registration'];
    if (section.kind === 'comment' && section.required) return ['comment'];
    if (section.kind === 'result_messages' && section.required) return ['result_messages'];
    return [];
  });
}

/**
 * Ключи окна, которые оно пишет мимо замка записи (#496, Р4, В10): поля
 * настроенного раздела и поля, добавленные ТОЛЬКО условием «Заполнены
 * поля», — пока они пусты (иначе условие уже выполнено и окно их не
 * спрашивает). Одна грамматика сервера и моков.
 */
export function windowWritableKeys(
  sections: readonly EffectiveSection[],
  filled: (key: TransitionWindowFieldKey) => boolean,
): Set<string> {
  const fieldsSection = sections.find((section) => section.kind === 'fields');
  if (fieldsSection?.kind !== 'fields') return new Set();
  return new Set<string>([
    ...fieldsSection.fields.filter((key) => !fieldsSection.gateKeys.includes(key)),
    ...fieldsSection.gateKeys.filter((key) => !filled(key)),
  ]);
}
