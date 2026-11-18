import { z } from 'zod';

import type { LetterHistoryEntry, WorkflowAction } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  asTyped,
  clip,
  dateTime,
  hasMore,
  pageItems,
  str,
} from '../projections.js';
import { lettersPartsMeta } from './meta/letters-parts.meta.js';

/**
 * Чтение действий и истории письма (#930): кнопки маршрута без смены статуса
 * и журнал изменений. Данные — API портала от имени сотрудника, права и
 * видимость письма проверяет он же.
 */

const ACTION_BLOCK_LABEL: Record<string, string> = {
  no_open_subtasks: 'есть открытые подзадачи',
  checklist_complete: 'чек-лист не завершён',
  fields_required: 'не заполнены обязательные поля',
  time_logged: 'нет трудозатрат',
  result_present: 'нет итога',
  result_files: 'нет файлов итога',
  decider_vacant: 'решающий не назначен',
};

export const lettersActionsTool = defineTool({
  ...lettersPartsMeta['letters.actions'],
  id: 'letters.actions',
  title: 'Письма: действия',
  description:
    'Кнопки действий письма без смены статуса: название, id, блокировка и наличие окна ввода. Нужны, чтобы нажать нужную через letters.press_action.',
  keywords: ['действия письма', 'кнопки письма', 'что можно нажать', 'actions'],
  module: 'letters',
  kind: 'read',
  featureFlag: 'correspondence',
  hot: false,
  input: z.object({ letterId: z.uuid() }),
  api: { method: 'GET', path: '/letters/:id/actions' },
  build: (input) => ({ path: `/letters/${input.letterId}/actions` }),
  project: (data) => {
    const actions = asArray(data)
      .map((raw) => asTyped<WorkflowAction>(raw))
      .filter((action): action is WorkflowAction => action !== null);
    if (actions.length === 0) return { text: 'Доступных действий по письму нет.' };
    return {
      text: [
        `Действия письма (${actions.length}):`,
        ...actions.map((action) => {
          const blocked = action.blockedBy
            .map((reason) => ACTION_BLOCK_LABEL[reason.kind] ?? reason.kind)
            .join(', ');
          const form = action.form?.enabled ? ' · окно ввода' : '';
          return `- ${action.name} · id ${action.id} · ${blocked ? `недоступно: ${blocked}` : 'доступно'}${form}`;
        }),
      ].join('\n'),
    };
  },
});

const HISTORY_LABEL: Record<LetterHistoryEntry['kind'], string> = {
  received: 'Получено',
  registered: 'Зарегистрировано',
  updated: 'Изменено',
  stage_changed: 'Смена стадии',
  participant_joined: 'Присоединился к обсуждению',
  action_pressed: 'Нажато действие',
  relation_changed: 'Связь писем',
};

function historyDetail(entry: LetterHistoryEntry): string | null {
  switch (entry.kind) {
    case 'registered':
      return `№${entry.regNumber}`;
    case 'updated':
      return entry.changes
        .slice(0, 5)
        .map((change) => `${change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`)
        .join('; ');
    case 'stage_changed':
      return `${entry.transitionName}: «${entry.fromStageName}» → «${entry.toStageName}»`;
    case 'action_pressed':
      return `«${entry.actionName}» на стадии «${entry.stageName}»`;
    case 'relation_changed':
      return `${entry.action}: ${entry.relationKind === 'reply_to' ? 'ответ на' : 'вложено в'} ${entry.relatedLetter.regNumber ?? entry.relatedLetter.subject ?? 'письмо'}`;
    default:
      return null;
  }
}

export const lettersHistoryTool = defineTool({
  ...lettersPartsMeta['letters.history'],
  id: 'letters.history',
  title: 'Письма: история',
  description:
    'История письма постранично: кто, когда и что изменил, регистрация, переходы, действия и связи. Курсор берётся из предыдущего ответа.',
  keywords: ['история письма', 'кто менял', 'что было с письмом', 'журнал изменений'],
  module: 'letters',
  kind: 'read',
  featureFlag: 'correspondence',
  hot: false,
  input: z.object({
    letterId: z.uuid(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  api: { method: 'GET', path: '/letters/:id/history' },
  build: (input) => ({
    path: `/letters/${input.letterId}/history`,
    query: {
      limit: String(input.limit),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    },
  }),
  project: (data) => {
    const entries = pageItems<LetterHistoryEntry>(data as never)
      .map((raw) => asTyped<LetterHistoryEntry>(raw))
      .filter((entry): entry is LetterHistoryEntry => entry !== null);
    if (entries.length === 0) return { text: 'История письма пуста.' };
    return {
      text: [
        `История письма (${entries.length}):`,
        ...entries.map((entry) => {
          const who = entry.actor?.displayName ?? 'система';
          const when = dateTime(entry.at) ?? entry.at;
          const detail = historyDetail(entry);
          return `- ${when} · ${who} · ${HISTORY_LABEL[entry.kind]}${detail ? `: ${clip(detail, 200)}` : ''}`;
        }),
        hasMore(data) ? `… есть следующая страница (cursor)` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  },
});

/** Проекция ответа письма после действия — общая для write-инструментов.
 *  PATCH/join/participants отдают письмо напрямую, нажатие действия — в
 *  обёртке `{ letter }`; поддерживаем обе формы. */
export function letterResultText(data: unknown): {
  number: string | null;
  subject: string | null;
  id: string | null;
} {
  const record = asRecord(data);
  const letter = asRecord(record?.letter) ?? record;
  return {
    number: str(letter?.regNumber),
    subject: str(letter?.subject),
    id: str(letter?.id),
  };
}

export const lettersPartsReadTools = [lettersActionsTool, lettersHistoryTool];
