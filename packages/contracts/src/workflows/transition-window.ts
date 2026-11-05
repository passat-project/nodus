import type {
  TransitionForm,
  TransitionFormSectionKind,
  TransitionWindowFieldKey,
} from './transition-form.schemas.js';
import { TRANSITION_FORM_SECTION_ORDER } from './transition-form.schemas.js';
import type { TransitionBlockReason, WorkflowTransitionRules } from './workflow.schemas.js';

/**
 * Эффективное окно перехода (#380, Р4 плана): разделы настройки кнопки ∪
 * разделы, выводимые из гейтов. Одна чистая грамматика для веба (что
 * показать) и сервера (что разрешено в теле) — заблокированная кнопка,
 * которую окно может разблокировать, открывает окно даже без настройки.
 * Исключение из «без логики в contracts» (patterns.md): грамматика обязана
 * совпадать байт-в-байт.
 */

/** Раздел эффективного окна: `origin` — настройка кнопки или гейт (веб
 *  показывает подпись по умолчанию для гейтового раздела). */
export type EffectiveSection =
  | { kind: 'registration'; origin: 'form' | 'gate' }
  | { kind: 'fields'; fields: TransitionWindowFieldKey[]; origin: 'form' | 'gate' }
  | { kind: 'time'; mode: 'if_empty' | 'always'; origin: 'form' | 'gate' }
  | { kind: 'result'; origin: 'form' | 'gate' }
  | { kind: 'result_files'; label: string; origin: 'form' | 'gate' }
  | { kind: 'result_messages'; required: boolean; origin: 'form' | 'gate' }
  | { kind: 'comment'; label: string; required: boolean; origin: 'form' | 'gate' };

export function effectiveWindowSections(
  form: TransitionForm | null,
  rules: Pick<WorkflowTransitionRules, 'validators'>,
): EffectiveSection[] {
  const sections = new Map<TransitionFormSectionKind, EffectiveSection>();
  if (form?.enabled) {
    for (const section of form.sections) sections.set(section.kind, { ...section, origin: 'form' });
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
    const fields = new Set<TransitionWindowFieldKey>(
      existing?.kind === 'fields' ? existing.fields : [],
    );
    for (const field of gateFields) fields.add(field);
    sections.set('fields', {
      kind: 'fields',
      fields: [...fields],
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

  return TRANSITION_FORM_SECTION_ORDER.flatMap((kind) => {
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
