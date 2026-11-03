import type { WorkflowFormApplied } from '../../../../core/ports/workflow-entity.port.js';
import type { TransitionDef } from '../transition-rules.js';
import { windowOf } from '../transition-form.js';

export const EMPTY_APPLIED: WorkflowFormApplied = {
  fields: {},
  timeEntryId: null,
  result: null,
};

export const hasApplied = (applied: WorkflowFormApplied): boolean =>
  Object.keys(applied.fields).length > 0 || applied.timeEntryId !== null || applied.result !== null;

/** Кнопка без обязательного окна не блокирует жест DnD/«Мой план». */
/** Подпись раздела «Причина / комментарий» окна (для блока в чате). */
export function commentLabelOf(t: TransitionDef): string | undefined {
  const section = t.form?.enabled ? t.form.sections.find((s) => s.kind === 'comment') : undefined;
  return section?.kind === 'comment' ? section.label : undefined;
}

/** Кнопка без обязательного окна не блокирует жест DnD/«Мой план». */
export function requiresWindow(t: TransitionDef): boolean {
  return windowOf(t.form, t.rules).required.length > 0;
}
