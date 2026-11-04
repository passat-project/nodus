import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LetterDetail,
  LetterListItem,
  LetterRelationKind,
  LetterTreeResponse,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { ApiError, api } from '../../../shared/api-client.js';
import { lettersKeys } from '../../../shared/api/letters-keys.js';
import { applyLetter, letterErrorText } from './letters-cache.js';
import { registrationReasonText, relationReasonText } from '../lib/registration-draft.js';
import { treeNodeOf, withRelation, withoutRelation } from '../lib/letter-tree.js';

/** Связи писем и «ёлочка» (#461, Р1/Р2): дерево сервера, постановка/замена/
 *  снятие — только канцелярия (сервер — истина, I8). Мутации оптимистичны
 *  (I4): узел встаёт/уходит в дереве до ответа, 422 откатывает снапшотом. */

const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;

const uiText = {
  linked: ui.letters.relations.linkedToast,
  unlinked: ui.letters.relations.unlinkedToast,
};

/** Дерево «ёлочки» от письма: корень — верх цепочки, текущее подсвечивает
 *  панель. 404 (невидимое письмо) не повторяется. */
export function useLetterTree(id: string) {
  return useQuery({
    queryKey: lettersKeys.tree(id),
    queryFn: () => api<LetterTreeResponse>(`/letters/${id}/tree`),
    enabled: id.length > 0,
    retry: (count, error) => !notFound(error) && count < 2,
  });
}

/** Текст 422 связи по причине (общая грамматика причин регистрации). */
export function relationErrorText(error: unknown): string {
  if (error instanceof ApiError && typeof error.details?.reason === 'string') {
    const reason = error.details.reason;
    if (reason in relationReasonText) {
      return relationReasonText[reason as keyof typeof relationReasonText];
    }
    if (reason in registrationReasonText) {
      return registrationReasonText[reason as keyof typeof registrationReasonText];
    }
  }
  return letterErrorText(error);
}

interface LinkVars {
  /** Письмо-источник связи (для «Добавить» — текущее, для «Заменить» — узел). */
  sourceId: string;
  /** Цель — строка списка из окна поиска. */
  target: LetterListItem;
  kind: LetterRelationKind;
  /** У источника уже есть связь этого вида — заменить. */
  replace: boolean;
}

/** `POST /letters/:sourceId/relations`: поставить или заменить связь. */
export function useLinkLetterRelation(rootId: string) {
  const queryClient = useQueryClient();
  const treeKey = lettersKeys.tree(rootId);
  return useMutation({
    mutationFn: (vars: LinkVars) =>
      api<LetterDetail>(`/letters/${vars.sourceId}/relations`, {
        method: 'POST',
        body: {
          relatedLetterId: vars.target.id,
          kind: vars.kind,
          ...(vars.replace ? { replace: true } : {}),
        },
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: treeKey });
      const previous = queryClient.getQueryData<LetterTreeResponse>(treeKey);
      if (previous) {
        queryClient.setQueryData<LetterTreeResponse>(
          treeKey,
          withRelation(previous, vars.sourceId, treeNodeOf(vars.target), vars.kind),
        );
      }
      return { previous };
    },
    // Отказ показывает окно связи — под полем (422) или переходом в замену
    // (`already_linked`); тост дублировал бы его.
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(treeKey, context.previous);
    },
    onSuccess: (letter) => {
      applyLetter(queryClient, letter);
      toast.success(uiText.linked);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: treeKey });
      void queryClient.invalidateQueries({ queryKey: lettersKeys.lists(), refetchType: 'none' });
    },
  });
}

/** `DELETE /letters/:sourceId/relations/:relationId`: снять связь. */
export function useUnlinkLetterRelation(rootId: string) {
  const queryClient = useQueryClient();
  const treeKey = lettersKeys.tree(rootId);
  return useMutation({
    mutationFn: (vars: { sourceId: string; relationId: string }) =>
      api<void>(`/letters/${vars.sourceId}/relations/${vars.relationId}`, { method: 'DELETE' }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: treeKey });
      const previous = queryClient.getQueryData<LetterTreeResponse>(treeKey);
      if (previous) {
        queryClient.setQueryData<LetterTreeResponse>(
          treeKey,
          withoutRelation(previous, vars.relationId),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(treeKey, context.previous);
      toast.error(relationErrorText(error));
    },
    onSuccess: (_result, vars) => {
      toast.success(uiText.unlinked);
      void queryClient.invalidateQueries({ queryKey: lettersKeys.detail(vars.sourceId) });
      void queryClient.invalidateQueries({ queryKey: lettersKeys.history(vars.sourceId) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: treeKey });
      void queryClient.invalidateQueries({ queryKey: lettersKeys.lists(), refetchType: 'none' });
    },
  });
}
