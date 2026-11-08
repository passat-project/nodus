import type { ErrorCode, TransitionBlockReason } from '@nodus/contracts';
import { errorMessages, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';
import { numberingErrorText } from '../custom-fields/number-confirm.js';

/** Причины гейтов строкой для тоста (общий текст отказа). */
export function gateReasonsText(reasons: readonly TransitionBlockReason[]): string {
  return reasons.map((r) => ui.tasks.gate[r.kind]).join('; ');
}

/** Текст ошибки перехода/переноса: гейты — с причинами; «из какого статуса
 *  так нельзя» — из `fromStageName`; прочие коды — общий словарь. */
export function transitionErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'WORKFLOW_TRANSITION_FORM_INVALID') return ui.tasks.transitionNeedsWindow;
    // Отказ выдачи номера (#630): «Номер «Изм.» не выдан: запись не лежит в
    // папке вида «Комплект»» — а не общий «не удалось сменить стадию».
    const numbering = numberingErrorText(error);
    if (numbering) return numbering;
    const reasons = (error.details?.reasons ?? []) as TransitionBlockReason[];
    if (reasons.length > 0)
      return `${errorMessages[error.code as ErrorCode]}: ${gateReasonsText(reasons)}`;
    const from = error.details?.fromStageName;
    if (error.code === 'WORKFLOW_TRANSITION_NOT_ALLOWED' && typeof from === 'string') {
      return `${ui.tasks.transitionNotAllowedFrom} «${from}» ${ui.tasks.transitionNotAllowedTail}`;
    }
    const known = errorMessages[error.code as ErrorCode];
    if (known && (error.code.startsWith('TASK_') || error.code.startsWith('WORKFLOW_'))) {
      return known;
    }
  }
  return ui.tasks.stageMoveError;
}
