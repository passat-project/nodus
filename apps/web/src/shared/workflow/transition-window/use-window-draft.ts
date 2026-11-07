import { useState } from 'react';
import type { CustomFieldValue, LetterRegistrationInput } from '@nodus/contracts';
import { customFieldIdOfKey } from '@nodus/contracts';

import { EMPTY_TIME_ENTRY, type TimeEntryDraft } from '../../tasks/time-entry-fields.js';
import type { TransitionWindowContext, WindowFieldValues } from './window-context.js';

/** Черновик окна: введённое пользователем до отправки. */
export interface WindowDraft {
  fields: WindowFieldValues;
  time: TimeEntryDraft;
  /** Текст итога (префилл — последняя ревизия). */
  resultText: string;
  /** Сообщения-файлы, выбранные в разделе «Файлы итога». */
  files: string[];
  /** Сообщения, отмеченные как отчёт в разделе «Сообщения». */
  messages: string[];
  /** id прежней ревизии итога: переносятся, пока пользователь их не заменил. */
  carried: string[];
  comment: string;
  /** Раздел «Регистрация» (#55): валидный ввод хоста или null (форма не
   *  дозаполнена) — окно не знает формы письма, только её итог. */
  registration: LetterRegistrationInput | null;
}

export function emptyDraft(
  context: TransitionWindowContext,
  prefill?: Readonly<Record<string, CustomFieldValue>>,
): WindowDraft {
  const fields: WindowFieldValues = {
    ...context.fields,
    customFields: { ...context.fields.customFields },
  };
  // Префилл формульных слотов (#632, Р12): сервер посчитал значение при
  // открытии; поле остаётся редактируемым, в тело уйдёт значением.
  for (const [key, value] of Object.entries(prefill ?? {})) {
    if (value === null || value === undefined) continue;
    const id = customFieldIdOfKey(key);
    if (id) {
      fields.customFields[id] = value;
      continue;
    }
    switch (key) {
      case 'description':
        if (typeof value === 'string') fields.description = value;
        break;
      case 'deadline':
        if (typeof value === 'string') fields.deadline = value;
        break;
      case 'assignee':
        if (typeof value === 'string') fields.assigneeId = value;
        break;
      case 'plannedMinutes':
        if (typeof value === 'number') fields.plannedMinutes = value;
        break;
      default:
        break;
    }
  }
  return {
    fields,
    time: { ...EMPTY_TIME_ENTRY },
    resultText: context.lastResult?.text ?? '',
    files: [],
    messages: [],
    carried: [...(context.lastResult?.messageIds ?? [])],
    comment: '',
    registration: null,
  };
}

/** Все id сообщений итога, которые уйдут в ревизию (для lookup и подсчёта файлов). */
export function draftMessageIds(draft: WindowDraft): string[] {
  return [...new Set([...draft.carried, ...draft.files, ...draft.messages])];
}

/**
 * Состояние черновика окна перехода. Префилл — текущие значения полей и
 * последняя ревизия итога; разделы только меняют черновик, сервер решает
 * (пессимистичная отправка). Переключение выбранного файла в пикере —
 * добавление/снятие его сообщения.
 */
export function useWindowDraft(
  context: TransitionWindowContext | null,
  prefill?: Readonly<Record<string, CustomFieldValue>>,
) {
  const [draft, setDraft] = useState<WindowDraft>(() =>
    context
      ? emptyDraft(context, prefill)
      : {
          fields: {
            description: '',
            deadline: null,
            assigneeId: null,
            plannedMinutes: null,
            customFields: {},
          },
          time: { ...EMPTY_TIME_ENTRY },
          resultText: '',
          files: [],
          messages: [],
          carried: [],
          comment: '',
          registration: null,
        },
  );

  const patch = (next: Partial<WindowDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  return {
    draft,
    setFields: (fields: WindowFieldValues) => patch({ fields }),
    setTime: (time: TimeEntryDraft) => patch({ time }),
    setResultText: (resultText: string) => patch({ resultText }),
    setComment: (comment: string) => patch({ comment }),
    setRegistration: (registration: LetterRegistrationInput | null) => patch({ registration }),
    toggleFile: (messageId: string) =>
      setDraft((prev) => ({
        ...prev,
        files: prev.files.includes(messageId)
          ? prev.files.filter((id) => id !== messageId)
          : [...prev.files, messageId],
        // Выбор из чата заменяет прежний перенос этого id (не дублируем).
        carried: prev.carried.filter((id) => id !== messageId),
      })),
    toggleMessage: (messageId: string) =>
      setDraft((prev) => ({
        ...prev,
        messages: prev.messages.includes(messageId)
          ? prev.messages.filter((id) => id !== messageId)
          : [...prev.messages, messageId],
        carried: prev.carried.filter((id) => id !== messageId),
      })),
    addFiles: (messageIds: string[]) =>
      setDraft((prev) => ({
        ...prev,
        files: [...new Set([...prev.files, ...messageIds])],
        carried: prev.carried.filter((id) => !messageIds.includes(id)),
      })),
    reset: () => context && setDraft(emptyDraft(context, prefill)),
  };
}
