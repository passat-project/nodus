import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type {
  ExecuteActionBody,
  ExecuteLetterTransitionResult,
  ExecuteTransitionBody,
  LetterDetail,
  UpdateLetterBody,
  WorkflowAction,
  WorkflowTransition,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api, apiUpload } from '../../../shared/api-client.js';
import { lettersKeys } from '../../../shared/api/letters-keys.js';
import type { LettersPages } from '../../../shared/api/letters-list.js';
import { letterWithMainDocument } from '../lib/letter-main-document.js';
import { chatKeys } from '../../../shared/chat/chat-keys.js';
import {
  alreadyRegisteredNumber,
  applyLetter,
  letterErrorText,
  listItemOf,
  registrationIssueOf,
  restoreLetterInLists,
  snapshotLetterInList,
  syncLetterInLists,
} from './letters-cache.js';

/**
 * Мутации писем (#55, Р16). ПЕССИМИСТИЧНЫ обоснованно: переход окна (номер
 * выдаёт сервер — юридически значимо; ввод не должен теряться), ручное
 * создание (файлы и письмо — атомарно на сервере), присоединение (состав
 * беседы решает сервер). ОПТИМИСТИЧНЫ (I4): правка регистрационных данных и
 * удаление спама из «Новых» — с откатом снапшотом.
 */

const listsStale = (queryClient: ReturnType<typeof useQueryClient>) =>
  void queryClient.invalidateQueries({ queryKey: lettersKeys.lists(), refetchType: 'none' });

/** Переход письма из окна/конвейера: письмо и НОВЫЕ кнопки одним ответом.
 *  Ключ идемпотентности — на попытку (письмо + кнопка): повтор после обрыва
 *  сети не выдаст второй номер. 422 полей и 409 повтора разбирает хост. */
export function useExecuteLetterTransition() {
  const queryClient = useQueryClient();
  const attempts = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: (vars: {
      letterId: string;
      transition: WorkflowTransition;
      body: ExecuteTransitionBody;
    }) => {
      const slot = `${vars.letterId}:${vars.transition.id}`;
      const idempotencyKey = attempts.current.get(slot) ?? crypto.randomUUID();
      attempts.current.set(slot, idempotencyKey);
      return api<ExecuteLetterTransitionResult>(
        `/letters/${vars.letterId}/transitions/${vars.transition.id}`,
        { method: 'POST', body: vars.body, idempotencyKey },
      );
    },
    onSuccess: (result, vars) => {
      attempts.current.delete(`${vars.letterId}:${vars.transition.id}`);
      applyLetter(queryClient, result.letter);
      queryClient.setQueryData(lettersKeys.transitions(result.letter.id), result.transitions);
      void queryClient.invalidateQueries({ queryKey: lettersKeys.history(result.letter.id) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.byLetter(result.letter.id) });
      listsStale(queryClient);
    },
    onError: (error) => {
      if (registrationIssueOf(error) || alreadyRegisteredNumber(error) !== null) return;
      toast.error(letterErrorText(error));
    },
  });
}

/** Нажатие действия письма (#633, аудит В1): окно пишет данные, статус прежний.
 *  Ответ — письмо и свежие кнопки; история перезапрашивается (аудит Б3). */
export function usePressLetterAction() {
  const queryClient = useQueryClient();
  const attempts = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: (vars: { letterId: string; action: WorkflowAction; body: ExecuteActionBody }) => {
      const slot = `${vars.letterId}:${vars.action.id}`;
      const idempotencyKey = attempts.current.get(slot) ?? crypto.randomUUID();
      attempts.current.set(slot, idempotencyKey);
      return api<ExecuteLetterTransitionResult>(
        `/letters/${vars.letterId}/actions/${vars.action.id}/press`,
        { method: 'POST', body: vars.body, idempotencyKey },
      );
    },
    onSuccess: (result, vars) => {
      attempts.current.delete(`${vars.letterId}:${vars.action.id}`);
      applyLetter(queryClient, result.letter);
      queryClient.setQueryData(lettersKeys.transitions(result.letter.id), result.transitions);
      void queryClient.invalidateQueries({ queryKey: lettersKeys.actions(result.letter.id) });
      void queryClient.invalidateQueries({ queryKey: lettersKeys.history(result.letter.id) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.byLetter(result.letter.id) });
      listsStale(queryClient);
    },
    onError: (error) => {
      toast.error(letterErrorText(error));
    },
  });
}

/** Выбор основного документа звездой («Основной документ письма» #56):
 *  вкладка «Письмо» меняется мгновенно (I4), ошибка — откат снапшотом. */
export function useSetMainDocument(id: string) {
  const queryClient = useQueryClient();
  const detailKey = lettersKeys.detail(id);
  return useMutation({
    mutationFn: (attachmentId: string) =>
      api<LetterDetail>(`/letters/${id}/main-document`, {
        method: 'POST',
        body: { attachmentId },
      }),
    onMutate: async (attachmentId) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<LetterDetail>(detailKey);
      const previousListItem = snapshotLetterInList(queryClient, id);
      if (previous) {
        const next = letterWithMainDocument(previous, attachmentId);
        queryClient.setQueryData(detailKey, next);
        syncLetterInLists(queryClient, id, listItemOf(next));
      }
      return { previous, previousListItem };
    },
    onError: (error, _attachmentId, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      restoreLetterInLists(queryClient, id, context?.previousListItem ?? null);
      toast.error(letterErrorText(error));
    },
    onSuccess: (letter) => {
      applyLetter(queryClient, letter);
      void queryClient.invalidateQueries({ queryKey: lettersKeys.history(id) });
    },
  });
}

/** Правка регистрационных данных (В3): поле меняется сразу, ошибка — откат. */
export function useUpdateLetter(id: string) {
  const queryClient = useQueryClient();
  const detailKey = lettersKeys.detail(id);
  return useMutation({
    mutationFn: (vars: { body: UpdateLetterBody; patch: Partial<LetterDetail> }) =>
      api<LetterDetail>(`/letters/${id}`, { method: 'PATCH', body: vars.body }),
    onMutate: async ({ patch }) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<LetterDetail>(detailKey);
      const previousListItem = snapshotLetterInList(queryClient, id);
      if (previous) {
        const next = { ...previous, ...patch };
        queryClient.setQueryData(detailKey, next);
        syncLetterInLists(queryClient, id, listItemOf(next));
      }
      return { previous, previousListItem };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      restoreLetterInLists(queryClient, id, context?.previousListItem ?? null);
      toast.error(letterErrorText(error));
    },
    onSuccess: (letter) => {
      applyLetter(queryClient, letter);
      void queryClient.invalidateQueries({ queryKey: lettersKeys.history(id) });
    },
    onSettled: () => {
      listsStale(queryClient);
    },
  });
}

/** Удаление спама из «Новых» (Р12): строка уходит сразу, ошибка — возврат. */
export function useDeleteSpamLetter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (letterId: string) => api<void>(`/letters/${letterId}`, { method: 'DELETE' }),
    onMutate: async (letterId) => {
      const previousListItem = snapshotLetterInList(queryClient, letterId);
      await queryClient.cancelQueries({ queryKey: lettersKeys.lists() });
      syncLetterInLists(queryClient, letterId, null);
      return { previousListItem };
    },
    onError: (error, letterId, context) => {
      restoreLetterInLists(queryClient, letterId, context?.previousListItem ?? null);
      toast.error(letterErrorText(error));
    },
    onSuccess: (_result, letterId) => {
      for (const key of [
        lettersKeys.detail(letterId),
        lettersKeys.history(letterId),
        lettersKeys.transitions(letterId),
      ]) {
        queryClient.removeQueries({ queryKey: key });
      }
      toast.success(ui.letters.spam.deletedToast);
    },
    onSettled: () => listsStale(queryClient),
  });
}

/** «Присоединиться к обсуждению» (Р10; редизайн #56 — канцелярия может
 *  начать обсуждение и до регистрации): участник со звуком, чат открывается. */
export function useJoinLetter(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<LetterDetail>(`/letters/${id}/join`, { method: 'POST' }),
    onSuccess: (letter) => {
      applyLetter(queryClient, letter);
      void queryClient.invalidateQueries({ queryKey: chatKeys.byLetter(id) });
      void queryClient.invalidateQueries({ queryKey: lettersKeys.history(id) });
      toast.success(ui.letters.card.joinedToast);
    },
    onError: (error) => toast.error(letterErrorText(error)),
  });
}

/** Пригласить коллегу в обсуждение (редизайн #56): право регистрации,
 *  любое состояние письма; состав беседы решает сервер — пессимистично. */
export function useInviteLetterParticipant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<LetterDetail>(`/letters/${id}/participants`, { method: 'POST', body: { userIds } }),
    onSuccess: (letter) => {
      applyLetter(queryClient, letter);
      void queryClient.invalidateQueries({ queryKey: chatKeys.byLetter(id) });
      void queryClient.invalidateQueries({ queryKey: lettersKeys.history(id) });
      toast.success(ui.letters.card.invitedToast);
    },
    onError: (error) => toast.error(letterErrorText(error)),
  });
}

/** Ручное создание входящего (бумага): multipart — поля, затем файлы. */
export function useCreateManualLetter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      typeId: string;
      files: File[];
      mainIndex: number;
      onProgress?: (fraction: number) => void;
    }) => {
      const form = new FormData();
      form.append('typeId', vars.typeId);
      form.append('mainIndex', String(vars.mainIndex));
      for (const file of vars.files) form.append('files', file, file.name);
      return apiUpload<LetterDetail>('/letters', form, {
        onProgress: vars.onProgress,
        mswBypassIfLive: 'letters',
      });
    },
    onSuccess: (letter) => {
      queryClient.setQueryData(lettersKeys.detail(letter.id), letter);
      // Новое письмо — сверху очереди «Новые» (без поиска), остальное догонит рефетч.
      queryClient.setQueryData<LettersPages>(lettersKeys.list('new'), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page, index) =>
                index === 0 ? { ...page, items: [listItemOf(letter), ...page.items] } : page,
              ),
            }
          : data,
      );
      listsStale(queryClient);
      toast.success(ui.letters.manual.createdToast);
    },
    onError: (error) => toast.error(letterErrorText(error)),
  });
}
