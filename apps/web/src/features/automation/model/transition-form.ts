import type {
  TransitionFormSectionDraft,
  TransitionFormSectionKind,
  TransitionWindowField,
  TransitionWindowFieldKey,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { CUSTOM_FIELD_LIMITS, TRANSITION_FORM_SECTION_ORDER, ui } from '@nodus/contracts';

/**
 * Чистые правки «Окна при нажатии» в черновике кнопки (#380): панель
 * инспектора только вызывает их и патчит `form` целиком. Обязательность
 * содержимого живёт в ГЕЙТАХ (Р3): «Обязательно» у времени/итога/файлов
 * правит `rules.validators`, а не форму — здесь только разделы с
 * собственной обязательностью (причина, сообщения).
 */

type Form = WorkflowDraftTransition['form'];
type Section = TransitionFormSectionDraft;

export const WINDOW_FIELDS: readonly TransitionWindowField[] = [
  'deadline',
  'plannedMinutes',
  'description',
  'assignee',
];

export function sectionOf<K extends TransitionFormSectionKind>(
  form: Form,
  kind: K,
): Extract<Section, { kind: K }> | undefined {
  return form.sections.find((s): s is Extract<Section, { kind: K }> => s.kind === kind);
}

/** Порядок разделов в массиве — фиксированный (грамматика окна, не ввод). */
function sorted(sections: Section[]): Section[] {
  return [...sections].sort(
    (a, b) =>
      TRANSITION_FORM_SECTION_ORDER.indexOf(a.kind) - TRANSITION_FORM_SECTION_ORDER.indexOf(b.kind),
  );
}

export function setWindowEnabled(form: Form, enabled: boolean): Form {
  return { ...form, enabled };
}

export function setWindowTitle(form: Form, title: string): Form {
  // Пробелы внутри сохраняем (набор «Согласование заказчика»), пустое —
  // «по умолчанию название кнопки» (схема всё равно обрежет пробелы).
  return { ...form, title: title.trim().length > 0 ? title.slice(0, 60) : undefined };
}

function defaultSection(kind: TransitionFormSectionKind): Section {
  switch (kind) {
    case 'fields':
      return { kind, fields: ['deadline'] };
    case 'time':
      return { kind, mode: 'if_empty' };
    case 'result':
      return { kind };
    case 'result_files':
      return { kind, label: ui.automation.window.sections.result_files };
    case 'result_messages':
      return { kind, required: false };
    case 'comment':
      return { kind, label: ui.automation.window.sections.comment, required: true };
    case 'registration':
      return { kind };
  }
}

/** Раздел вкл/выкл: включение — с осмысленными значениями по умолчанию. */
export function toggleSection(form: Form, kind: TransitionFormSectionKind): Form {
  const exists = form.sections.some((s) => s.kind === kind);
  const sections = exists
    ? form.sections.filter((s) => s.kind !== kind)
    : [...form.sections, defaultSection(kind)];
  return { ...form, sections: sorted(sections) };
}

export function setLabel(form: Form, kind: 'result_files' | 'comment', label: string): Form {
  return {
    ...form,
    sections: form.sections.map((s) =>
      s.kind === kind ? ({ ...s, label: label.slice(0, 60) } as Section) : s,
    ),
  };
}

export function setRequired(
  form: Form,
  kind: 'comment' | 'result_messages',
  required: boolean,
): Form {
  return {
    ...form,
    sections: form.sections.map((s) => (s.kind === kind ? ({ ...s, required } as Section) : s)),
  };
}

/** Поле раздела вкл/выкл: системные и поля процесса (`cf.<id>`, #431) — в
 *  одном массиве; последнее не снимается, лимит раздела — 12 (Р7).
 *  Формулы-подстановки (#632, Р12) снятого поля удаляются вместе с ним. */
export function toggleWindowField(form: Form, field: TransitionWindowFieldKey): Form {
  const section = sectionOf(form, 'fields');
  if (!section) return form;
  const fields = new Set<string>(section.fields);
  if (fields.has(field)) fields.delete(field);
  else {
    if (fields.size >= CUSTOM_FIELD_LIMITS.windowFields) return form;
    fields.add(field);
  }
  if (fields.size === 0) return form; // раздел без полей бессмыслен — не снимаем последнее
  const formulas = Object.fromEntries(
    Object.entries(section.formulas ?? {}).filter(([key]) => fields.has(key)),
  );
  return {
    ...form,
    sections: form.sections.map((s) =>
      s.kind === 'fields'
        ? {
            kind: 'fields',
            fields: [...fields] as TransitionWindowFieldKey[],
            ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
          }
        : s,
    ),
  };
}

/** Формула-подстановка поля окна (#632, Р12): null — снять. */
export function setWindowFieldFormula(
  form: Form,
  field: TransitionWindowFieldKey,
  ast: import('@nodus/contracts').FormulaNode | null,
): Form {
  const section = sectionOf(form, 'fields');
  if (!section || !section.fields.includes(field)) return form;
  const formulas = { ...(section.formulas ?? {}) };
  if (ast) formulas[field] = ast;
  else delete formulas[field];
  return {
    ...form,
    sections: form.sections.map((s) =>
      s.kind === 'fields'
        ? {
            kind: 'fields',
            fields: section.fields,
            ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
          }
        : s,
    ),
  };
}

export function setTimeMode(form: Form, mode: 'if_empty' | 'always'): Form {
  return {
    ...form,
    sections: form.sections.map((s) => (s.kind === 'time' ? { kind: 'time', mode } : s)),
  };
}

/** Раздел «Файлы итога» включён — минимум файлов в гейте (0 — выключить гейт). */
export function hasFilesSection(form: Form): boolean {
  return form.sections.some((s) => s.kind === 'result_files');
}
