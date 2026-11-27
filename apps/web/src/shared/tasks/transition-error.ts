import type { ConditionRecordRef, ErrorCode, TransitionBlockReason } from '@nodus/contracts';
import { CONDITION_LIMITS, errorMessages, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';
import { plural } from '../lib/format.js';
import { numberingErrorText } from '../custom-fields/number-confirm.js';

/** Причина отказа одной строкой (#635): records/formula несут подпись
 *  настройщика; у records — ещё записи-нарушители (имена), «и ещё N»
 *  невидимых и хвост totalCount сверх показанных. Переполненная выборка —
 *  строка «проверка не может быть посчитана». Ссылки из имени недоступны —
 *  для кликабельных записей используйте `gateReasonLines` + список в
 *  диалоге/подсказке. */
export function gateReasonsText(reasons: readonly TransitionBlockReason[]): string {
  return gateReasonLines(reasons)
    .map((line) => {
      if (line.overflow) return `${line.title}: ${overflowText()}`;
      const names = line.refs.map((ref) => ref.name);
      const parts = [names.join(', '), hiddenText(line), moreText(line)].filter(Boolean);
      const tail = parts.join('; ');
      return tail ? `${line.title}: ${tail}` : line.title;
    })
    .join('; ');
}

/** «и ещё N без доступа» — невидимые нажавшему записи причины. */
function hiddenText(line: GateReasonLine): string | null {
  if (line.hiddenCount <= 0) return null;
  return `${ui.tasks.gateHiddenPrefix} ${line.hiddenCount} ${plural(line.hiddenCount, [
    ui.tasks.gateHiddenOne,
    ui.tasks.gateHiddenFew,
    ui.tasks.gateHiddenMany,
  ])}`;
}

/** «и ещё N записей» — нарушители сверх показанных (totalCount причины). */
export function moreRecordsText(count: number): string {
  return `${ui.tasks.gateHiddenPrefix} ${count} ${plural(count, [
    ui.tasks.gateMoreOne,
    ui.tasks.gateMoreFew,
    ui.tasks.gateMoreMany,
  ])}`;
}

function moreText(line: GateReasonLine): string | null {
  const rest = line.totalCount - line.refs.length;
  return rest > 0 ? moreRecordsText(rest) : null;
}

/** «Проверка не может быть посчитана: в выборке больше N записей» — потолок
 *  CONDITION_LIMITS.selection превышен, квантор не считался (#635). */
export function overflowText(): string {
  return `${ui.tasks.gateOverflowPrefix} ${CONDITION_LIMITS.selection} ${plural(
    CONDITION_LIMITS.selection,
    [ui.tasks.gateMoreOne, ui.tasks.gateMoreFew, ui.tasks.gateMoreMany],
  )}`;
}

/** Структура причины для интерфейса: подпись + записи-ссылки + счётчики
 *  («видимость одна» — причина не называет скрытые записи; totalCount —
 *  полный состав нарушителей, overflow — выборка не считалась). */
export interface GateReasonLine {
  title: string;
  refs: ConditionRecordRef[];
  hiddenCount: number;
  /** Полное число нарушителей: хвост сверх refs — «и ещё N записей». */
  totalCount: number;
  /** Выборка больше потолка: квантор не считался (fail-closed). */
  overflow: boolean;
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
    totalCount: reason.totalCount ?? reason.records?.length ?? 0,
    overflow: reason.overflow === true,
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
