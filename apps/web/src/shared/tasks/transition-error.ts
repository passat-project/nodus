import type { ConditionRecordRef, ErrorCode, TransitionBlockReason } from '@nodus/contracts';
import { errorMessages, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';
import { plural } from '../lib/format.js';
import { numberingErrorText } from '../custom-fields/number-confirm.js';

/** Причина отказа одной строкой (#635): records/formula несут подпись
 *  настройщика; у records — ещё записи-нарушители (имена) и «и ещё N»
 *  невидимых. Ссылки из имени недоступны — для кликабельных записей
 *  используйте `gateReasonLines` + список в диалоге/подсказке. */
export function gateReasonsText(reasons: readonly TransitionBlockReason[]): string {
  return gateReasonLines(reasons)
    .map((line) => {
      const names = line.refs.map((ref) => ref.name);
      const hidden =
        line.hiddenCount > 0
          ? `${ui.tasks.gateHiddenPrefix} ${line.hiddenCount} ${plural(line.hiddenCount, [
              ui.tasks.gateHiddenOne,
              ui.tasks.gateHiddenFew,
              ui.tasks.gateHiddenMany,
            ])}`
          : null;
      const tail = [names.join(', '), hidden].filter(Boolean).join('; ');
      return tail ? `${line.title}: ${tail}` : line.title;
    })
    .join('; ');
}

/** Структура причины для интерфейса: подпись + записи-ссылки + счётчик
 *  невидимых («видимость одна» — причина не называет скрытые записи). */
export interface GateReasonLine {
  title: string;
  refs: ConditionRecordRef[];
  hiddenCount: number;
}

/** Причины блокировки в структурированном виде: карточка и диалог отказа
 *  рендерят записи кликабельными ссылками (переход к задаче/письму/проекту
 *  по entityKind), а тосты/тултипы — строкой `gateReasonsText`. */
export function gateReasonLines(reasons: readonly TransitionBlockReason[]): GateReasonLine[] {
  return reasons.map((reason) => ({
    // records/formula (#635): точная подпись — та, что написал настройщик.
    title: reason.title ?? ui.tasks.gate[reason.kind],
    refs: reason.records ?? [],
    hiddenCount: reason.hiddenCount ?? 0,
  }));
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
