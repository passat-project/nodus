import type {
  EffectiveSection,
  TransitionBlockReason,
  WorkflowTransition,
  WorkflowValidator,
} from '@nodus/contracts';
import { customFieldIdOfKey, gateFixableBy, isCustomFieldValueFilled } from '@nodus/contracts';

import { timeEntryBody, timeEntryError } from '../../tasks/time-entry-fields.js';
import { draftMessageIds, type WindowDraft } from './use-window-draft.js';
import type { TransitionWindowContext } from './window-context.js';

/** Строка живого списка условий окна: ✓/✗ и исправимость окном. */
export interface WindowConditionLine {
  validator: WorkflowValidator;
  ok: boolean;
  /** Окно этого актора может исправить (иначе — ссылка «Открыть …»). */
  fixable: boolean;
}

/** Причина блокировки этого вида из ответа сервера (если кнопка уже блокировалась). */
function reasonOf(
  transition: WorkflowTransition,
  kind: TransitionBlockReason['kind'],
): TransitionBlockReason | undefined {
  return transition.blockedBy.find((r) => r.kind === kind);
}

function fieldsFilled(
  fields: readonly string[],
  context: TransitionWindowContext,
  draft: WindowDraft,
): boolean {
  return fields.every((field) => {
    switch (field) {
      case 'description':
        return draft.fields.description.trim().length > 0;
      case 'deadline':
        return draft.fields.deadline !== null;
      case 'assignee':
        return draft.fields.assigneeId !== null;
      case 'plannedMinutes':
        return draft.fields.plannedMinutes !== null;
      case 'result':
        return draft.resultText.trim().length > 0;
      default: {
        // Поле процесса (#431, Р7): неизвестный/архивный ключ не блокирует —
        // гейт на сервере тоже пропускает неактивное определение.
        const id = customFieldIdOfKey(field);
        if (id === null) return true;
        return isCustomFieldValueFilled(draft.fields.customFields[id]);
      }
    }
  });
}

/**
 * Живой список условий кнопки (✓/✗): гейты пересчитываются по черновику,
 * неисправимые в окне (подзадачи, чек-лист) — по ответу сервера. Одна
 * грамматика с сервером (`gateFixableBy`), но точное «отмечено в разделе
 * сообщений» держит окно.
 */
export function windowConditionLines({
  transition,
  context,
  draft,
  attachmentCount,
}: {
  transition: WorkflowTransition;
  context: TransitionWindowContext;
  draft: WindowDraft;
  attachmentCount: number;
}): WindowConditionLine[] {
  return transition.validators.map((validator) => {
    switch (validator.kind) {
      case 'no_open_subtasks':
      case 'checklist_complete':
        return {
          validator,
          ok: reasonOf(transition, validator.kind) === undefined,
          fixable: false,
        };
      case 'fields_required': {
        const reason = reasonOf(transition, 'fields_required');
        const fields = reason?.fields ?? validator.fields;
        return {
          validator,
          ok: fieldsFilled(fields, context, draft),
          fixable: context.access.canEdit,
        };
      }
      case 'time_logged':
        return {
          validator,
          ok: context.spentMinutes > 0 || timeEntryBody(draft.time) !== null,
          fixable: context.access.canLogTime,
        };
      case 'result_present':
        return {
          validator,
          ok: draft.resultText.trim().length > 0 || Boolean(context.lastResult?.text.trim()),
          fixable: context.access.canCheck,
        };
      case 'result_files':
        return {
          validator,
          ok: attachmentCount >= validator.min,
          fixable: context.access.canCheck,
        };
    }
  });
}

/**
 * Причина, по которой ввод раздела «Трудозатраты» не станет записью
 * (#866, AUD-009): формат или предел 24 часа. Режим `if_empty` при уже
 * списанном времени раздел не учитывает — как и тело запроса.
 */
export function timeSectionIssue(
  section: Extract<EffectiveSection, { kind: 'time' }>,
  draft: WindowDraft,
  spentMinutes: number,
): 'format' | 'limit' | null {
  if (section.mode === 'if_empty' && spentMinutes > 0) return null;
  return timeEntryError(draft.time);
}

/** Главная кнопка окна активна: все условия ✓ и обязательные разделы заполнены. */
export function windowCanSubmit({
  sections,
  lines,
  draft,
  spentMinutes = 0,
}: {
  sections: readonly EffectiveSection[];
  lines: readonly WindowConditionLine[];
  draft: WindowDraft;
  /** Уже списанные минуты: для `if_empty` раздел «Трудозатраты» не обязателен. */
  spentMinutes?: number;
}): boolean {
  if (!lines.every((line) => line.ok)) return false;
  for (const section of sections) {
    if (section.kind === 'time' && timeSectionIssue(section, draft, spentMinutes) !== null) {
      return false;
    }
    if (section.kind === 'comment' && section.required && !draft.comment.trim()) return false;
    // Регистрация письма кнопку НЕ блокирует (вердикт владельца 28.10):
    // попытка с пропусками уходит на сервер, 422 возвращается в окно и
    // красит рамки незаполненных — мёртвая кнопка и текстовые списки убраны.
    if (section.kind === 'result_messages' && section.required && draft.messages.length === 0) {
      return false;
    }
  }
  return true;
}

/** id сообщений, по которым окно считает файлы (для гейта result_files). */
export function resultMessageIdsOf(draft: WindowDraft): string[] {
  return draftMessageIds(draft);
}

/** Исправима ли причина блокировки этим актором (для маршрутизации). */
export function canFixReason(
  reason: TransitionBlockReason,
  access: TransitionWindowContext['access'],
): boolean {
  switch (gateFixableBy(reason.kind)) {
    case 'fields':
      return access.canEdit;
    case 'time':
      return access.canLogTime;
    case 'result':
    case 'result_files':
      return access.canCheck;
    default:
      return false;
  }
}
