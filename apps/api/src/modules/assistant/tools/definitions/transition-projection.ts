import type { TransitionFormSectionKind, WorkflowTransition } from '@nodus/contracts';

import { asArray, asRecord, num, str } from '../projections.js';

/**
 * Человеческие подписи перехода задачи (#920): разделы окна, поля, причины
 * гейтов и исход стадии. Вынесено из `tasks-transition.tools.ts` по I5:
 * карточка и проекция читают один словарь, сырые коды контракта в ответ
 * модели не попадают.
 */

/** Подписи разделов окна перехода (реестр разделов закрыт, ADR-0020). */
const SECTION_LABELS: Record<TransitionFormSectionKind, string> = {
  registration: 'Регистрация',
  fields: 'Поля',
  time: 'Трудозатраты (минуты, дата)',
  result: 'Итог (текст)',
  result_files: 'Файлы итога (приложить в портале)',
  result_messages: 'Сообщения итога (id)',
  comment: 'Комментарий',
};

/** Подписи системных полей раздела «Поля». */
const FIELD_LABELS: Record<string, string> = {
  description: 'Описание',
  deadline: 'Срок',
  assignee: 'Исполнитель',
  plannedMinutes: 'План, мин',
};

/** Подписи причин блокировки перехода (коды контракта). */
const GATE_LABELS: Record<string, string> = {
  no_open_subtasks: 'есть незавершённые подзадачи',
  checklist_complete: 'не все пункты чек-листа выполнены',
  fields_required: 'не заполнены обязательные поля',
  time_logged: 'не внесены трудозатраты',
  result_present: 'не заполнен итог',
  result_files: 'не приложены файлы итога',
  decider_vacant: 'не назначен решающий',
};

/** Итог целевой стадии: «завершает задачу» только с уточнением исхода. */
export const OUTCOME_LABELS: Record<string, string> = {
  success: 'завершает задачу (успешно)',
  cancelled: 'завершает задачу: отменена',
  rejected: 'завершает задачу: отклонена',
};

/** Ограничения перехода человеческими подписями + возможность обхода. */
export function blockedSummary(transition: WorkflowTransition): string | null {
  const reasons = asArray(transition.blockedBy)
    .map((raw) => gateLabel(raw))
    .filter((label): label is string => label !== null);
  if (reasons.length === 0) return null;
  const override = transition.canOverride ? ' (можно обойти с причиной)' : '';
  return `ограничения: ${reasons.join('; ')}${override}`;
}

export function gateLabel(raw: unknown): string | null {
  const record = asRecord(raw);
  const kind = str(record?.kind);
  if (!kind) return null;
  const base = GATE_LABELS[kind] ?? kind;
  if (kind === 'fields_required') {
    const fields = asArray(record?.fields)
      .map((fieldKey) => fieldLabel(fieldKey))
      .filter((label): label is string => label !== null);
    if (fields.length > 0) return `${base}: ${fields.join(', ')}`;
  }
  const count = num(record?.count);
  if (kind === 'no_open_subtasks' && count) return `${base} (${count})`;
  const min = num(record?.min);
  if (kind === 'result_files' && min) return `${base} (нужно ${min})`;
  return base;
}

/** Требования окна перехода — подписи разделов и полей (не сырые коды). */
export function formRequirements(form: unknown): string | null {
  const record = asRecord(form);
  if (!record || record.enabled !== true) return null;
  const parts: string[] = [];
  for (const raw of asArray(record.sections)) {
    const section = asRecord(raw);
    const kind = str(section?.kind) as TransitionFormSectionKind | null;
    if (!kind) continue;
    const label = str(section?.label) ?? SECTION_LABELS[kind] ?? kind;
    if (kind === 'fields') {
      const fields = asArray(section?.fields)
        .map((item) => fieldLabel(item))
        .filter((item): item is string => item !== null);
      parts.push(fields.length > 0 ? `${label}: ${fields.join(', ')}` : label);
    } else if (kind === 'comment' || kind === 'result_messages') {
      parts.push(section?.required === true ? `${label} (обязательно)` : label);
    } else {
      parts.push(label);
    }
  }
  return parts.length > 0 ? parts.join('; ') : 'поля формы перехода';
}

/** Подпись поля окна: строковый ключ (наследие) или объект с `label`. */
function fieldLabel(raw: unknown): string | null {
  if (typeof raw === 'string') return keyLabel(raw);
  const record = asRecord(raw);
  if (!record) return null;
  const label = str(record.label);
  if (label) return label;
  const key = str(record.key);
  return key ? keyLabel(key) : null;
}

function keyLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (key.startsWith('cf.')) return `атрибут ${key.slice(3, 11)}`;
  return key;
}
