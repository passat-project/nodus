import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type {
  WorkflowFormApplied,
  WorkflowStageChangeMeta,
} from '../../../../core/ports/workflow-entity.port.js';
import type { NumberSeriesService } from '../../numbering/number-series.service.js';
import type { TransitionDef } from '../transition-rules.js';
import { windowOf } from '../transition-form.js';

export const EMPTY_APPLIED: WorkflowFormApplied = {
  fields: {},
  timeEntryId: null,
  result: null,
};

export const hasApplied = (applied: WorkflowFormApplied): boolean =>
  Object.keys(applied.fields).length > 0 || applied.timeEntryId !== null || applied.result !== null;

/** Подпись раздела «Причина / комментарий» окна (для блока в чате). */
export function commentLabelOf(t: TransitionDef): string | undefined {
  const section = t.form?.enabled ? t.form.sections.find((s) => s.kind === 'comment') : undefined;
  return section?.kind === 'comment' ? section.label : undefined;
}

/** Кнопка без обязательного окна не блокирует жест DnD/«Мой план». */
export function requiresWindow(t: TransitionDef): boolean {
  return windowOf(t.form, t.rules).required.length > 0;
}

/** Пост-функция «Присвоить номер» письма: номер из серии типа сущности.
 *  Пост-функции с `fieldId` (номер в атрибут-счётчик задачи, #630) этот
 *  путь не трогает — их выдаёт адаптер задач (Пакет B3 техплана). */
export async function assignNumber(
  numbers: NumberSeriesService,
  tx: TransactionClient,
  subject: { typeId: string },
  t: TransitionDef,
): Promise<WorkflowStageChangeMeta['numbering']> {
  if (!t.rules.postFunctions.some((pf) => pf.kind === 'assign_number' && !pf.fieldId)) {
    return undefined;
  }
  return numbers.nextForType(tx, subject.typeId);
}
