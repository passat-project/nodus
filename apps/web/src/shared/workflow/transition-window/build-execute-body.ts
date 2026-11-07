import type { CustomFieldValue, EffectiveSection, ExecuteTransitionBody } from '@nodus/contracts';
import { customFieldIdOfKey, isCustomFieldValueFilled } from '@nodus/contracts';

import { timeEntryBody } from '../../tasks/time-entry-fields.js';
import { draftMessageIds, type WindowDraft } from './use-window-draft.js';
import type { TransitionWindowContext } from './window-context.js';

/**
 * Сборщик тела выполнения перехода (#380) — чистая функция: отправляется
 * только изменённое (поля — дифф с текущими, итог — при смене текста или
 * набора сообщений), пустое не уходит. Без раздела «Итог» текст берётся из
 * прежней ревизии; id прежнего итога переносятся, пока пользователь их не
 * заменил (файл итога — сообщение чата, канон #252).
 */
export function buildExecuteBody({
  sections,
  context,
  draft,
}: {
  sections: readonly EffectiveSection[];
  context: TransitionWindowContext;
  draft: WindowDraft;
}): ExecuteTransitionBody {
  const form: NonNullable<ExecuteTransitionBody['form']> = {};
  const fieldsSection = sections.find((s) => s.kind === 'fields');

  if (fieldsSection?.kind === 'fields') {
    const fields: NonNullable<NonNullable<typeof form.fields>> = {};
    const allowed = new Set(fieldsSection.fields);
    // Формульные слоты окна (#632, Р12) отправляются ВСЕГДА, даже без
    // правки: иначе дифф-механика опустит нетронутое поле и снимок в
    // журнале перехода не сохранится (F2).
    const formulaKeys = new Set(Object.keys(fieldsSection.formulas ?? {}));
    const description = draft.fields.description.trim();
    if (
      allowed.has('description') &&
      (description !== context.fields.description || formulaKeys.has('description')) &&
      description
    ) {
      fields.description = description;
    }
    if (
      allowed.has('deadline') &&
      (draft.fields.deadline !== context.fields.deadline || formulaKeys.has('deadline'))
    ) {
      if (draft.fields.deadline) fields.deadline = draft.fields.deadline;
    }
    if (
      allowed.has('assignee') &&
      (draft.fields.assigneeId !== context.fields.assigneeId || formulaKeys.has('assignee'))
    ) {
      if (draft.fields.assigneeId) fields.assigneeId = draft.fields.assigneeId;
    }
    if (
      allowed.has('plannedMinutes') &&
      (draft.fields.plannedMinutes !== context.fields.plannedMinutes ||
        formulaKeys.has('plannedMinutes'))
    ) {
      if (draft.fields.plannedMinutes) fields.plannedMinutes = draft.fields.plannedMinutes;
    }
    // Поля процесса (#431, Р7): уходят только реально изменённые значения;
    // очистка в окне не выражается (раздел «дозаполнить», не «очистить»).
    const customFields: Record<string, CustomFieldValue> = {};
    for (const key of allowed) {
      const id = customFieldIdOfKey(key);
      if (id === null) continue;
      const next = draft.fields.customFields[id];
      const previous = context.fields.customFields[id];
      if (next === undefined || next === null) continue;
      // Пустое значение не уходит даже при formula-always-send (A8-2): пустой
      // список/строка не проходят грамматику поля и дают 422 на поле, которое
      // человек не трогал.
      if (!isCustomFieldValueFilled(next)) continue;
      if (JSON.stringify(next) !== JSON.stringify(previous) || formulaKeys.has(key)) {
        customFields[id] = next;
      }
    }
    if (Object.keys(customFields).length > 0) fields.customFields = customFields;
    if (Object.keys(fields).length > 0) form.fields = fields;
  }

  const timeSection = sections.find((s) => s.kind === 'time');
  if (timeSection?.kind === 'time') {
    const body = timeEntryBody(draft.time);
    const skip = timeSection.mode === 'if_empty' && context.spentMinutes > 0;
    if (body && !skip) form.time = body;
  }

  const resultSection = sections.some(
    (s) => s.kind === 'result' || s.kind === 'result_files' || s.kind === 'result_messages',
  );
  if (resultSection) {
    const text = sections.some((s) => s.kind === 'result')
      ? draft.resultText.trim()
      : (context.lastResult?.text ?? '');
    const messageIds = draftMessageIds(draft);
    const previous = context.lastResult;
    const changed =
      text !== (previous?.text ?? '') ||
      messageIds.length !== (previous?.messageIds.length ?? 0) ||
      messageIds.some((id) => !(previous?.messageIds ?? []).includes(id));
    if (changed) form.result = { text, messageIds };
  }

  // Регистрация (#55, Р1): ввод хоста уходит целиком — номер выдаёт сервер.
  if (sections.some((s) => s.kind === 'registration') && draft.registration) {
    form.registration = draft.registration;
  }

  const commentSection = sections.find((s) => s.kind === 'comment');
  if (commentSection?.kind === 'comment' && draft.comment.trim()) {
    form.comment = draft.comment.trim();
  }

  return Object.keys(form).length > 0 ? { form } : {};
}
