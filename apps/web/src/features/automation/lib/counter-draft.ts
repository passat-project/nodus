import type { NumberHostKind } from '@nodus/contracts';
import {
  numberContainerReachable,
  numberCreateTriggerProblem,
  numberHostHasButtons,
} from '@nodus/contracts';

import type { FieldDraft } from './field-draft.js';

/** Черновик счётчика в окне атрибута (#630, модель v3): совместимость
 *  привязок с условиями «отдельно для» и способы выдачи по типам. Вынесено
 *  из field-draft.ts (I5) — там общий черновик атрибута любого типа. */

/** Вид записи привязки — для совместимости с «отдельно для». */
export type BindingHostKindOf = (targetId: string) => NumberHostKind | null;

const boundIds = (draft: FieldDraft) => [
  ...draft.bindings.processTypeIds,
  ...draft.bindings.projectTypeIds,
  ...draft.bindings.nodeKindIds,
];

/** Привязки, чьи записи не лежат в условиях счётчика (письмо — в папке,
 *  проект — в проекте): пока они отмечены, сохранить нельзя. */
export function unreachableBindings(draft: FieldDraft, hostKindOf: BindingHostKindOf): string[] {
  return boundIds(draft).filter((id) => {
    const host = hostKindOf(id);
    return (
      host !== null &&
      !draft.numbering.containers.every((container) => numberContainerReachable(container, host))
    );
  });
}

/** «При создании» только у отмеченных типов: отвязанный тип теряет и его. */
export function onCreateOf(draft: FieldDraft): string[] {
  const bound = new Set(boundIds(draft));
  return draft.numberingOnCreate.filter((id) => bound.has(id));
}

/** Типы, которым номер никто не выдаст и выдать нечем: папки и проекты без
 *  «при создании» (кнопок у них нет); письмо «при создании» со счётом по
 *  месту или полями письма. Пока они есть, сохранить нельзя. */
export function triggerProblems(draft: FieldDraft, hostKindOf: BindingHostKindOf): string[] {
  const onCreate = new Set(onCreateOf(draft));
  return boundIds(draft).filter((id) => {
    const host = hostKindOf(id);
    if (host === null) return false;
    if (!numberHostHasButtons(host)) return !onCreate.has(id);
    return onCreate.has(id) && numberCreateTriggerProblem(draft.numbering, host) !== null;
  });
}
