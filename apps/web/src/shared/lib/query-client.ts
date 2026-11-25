import {
  MutationCache,
  QueryClient,
  type MutationOptions,
  type MutationState,
} from '@tanstack/react-query';

import { currentSessionEpoch } from './session-epoch.js';

/**
 * Мутация привязана к сессии, в которой её запустили (AUD-005): после сброса
 * (выход, смена аккаунта в той же вкладке) её колбэки не пишут в кэш и не
 * откатывают снапшоты прежнего пользователя. `queryClient.clear()` в полёте
 * мутацию не отменяет — ответ «из прошлой сессии» иначе клал строки прежнего
 * пользователя (деталь, страницы журнала, оверлей досок) в чистый кэш
 * следующего. Пер-вызов колбэки `mutate(vars, { onSuccess })` — диалоговые,
 * работают с размонтированными компонентами и здесь не затрагиваются.
 *
 * Сессия фиксируется в момент СТАРТА мутации (не при создании обсёрвера):
 * между монтированием хука и кликом сессия могла смениться — мутация нового
 * пользователя обязана работать как обычная. Повтор (retry) сессию не
 * перефиксирует: переподключение после смены аккаунта не делает чужой запрос
 * «своим».
 */
class SessionBoundMutationCache extends MutationCache {
  override build<TData, TError, TVariables, TContext>(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TContext>,
    state?: MutationState<TData, TError, TVariables, TContext>,
  ) {
    return super.build(client, bindToSession(options), state);
  }
}

function bindToSession<TData, TError, TVariables, TContext>(
  options: MutationOptions<TData, TError, TVariables, TContext>,
): MutationOptions<TData, TError, TVariables, TContext> {
  let started: number | null = null;
  const begin = (): void => {
    started ??= currentSessionEpoch();
  };
  const live = (): boolean => started === currentSessionEpoch();
  const { mutationFn, onMutate, onSuccess, onError, onSettled } = options;
  return {
    ...options,
    ...(mutationFn && {
      mutationFn: (...args: Parameters<typeof mutationFn>) => {
        begin();
        return mutationFn(...args);
      },
    }),
    ...(onMutate && {
      onMutate: (...args: Parameters<typeof onMutate>) => {
        begin();
        return onMutate(...args);
      },
    }),
    ...(onSuccess && {
      onSuccess: (...args: Parameters<typeof onSuccess>) =>
        live() ? onSuccess(...args) : undefined,
    }),
    ...(onError && {
      onError: (...args: Parameters<typeof onError>) => (live() ? onError(...args) : undefined),
    }),
    ...(onSettled && {
      onSettled: (...args: Parameters<typeof onSettled>) =>
        live() ? onSettled(...args) : undefined,
    }),
  };
}

/**
 * Единственный клиент кэша запросов SPA. Живёт в shared, а не в app:
 * сброс сессии (`shared/session-reset.ts`) обязан очищать кэш при выходе и
 * смене аккаунта, а слою shared нельзя импортировать app (boundaries).
 */
export const queryClient = new QueryClient({
  mutationCache: new SessionBoundMutationCache(),
  defaultOptions: {
    queries: {
      // I4: данные считаем свежими 30 с — без лишних фоновых перезапросов;
      // мутации инвалидируют ключи явно.
      staleTime: 30_000,
      // Данные закрытого раздела живут в памяти 30 минут (стандарт — 5):
      // за день сотрудник много раз возвращается в тот же раздел, и пока
      // кэш жив, возврат показывает его сразу и освежает фоном, а не держит
      // пустой скелет до ответа сервера (#1051). Выход кэш чистит целиком
      // (`session-reset.ts`) — чужие данные в памяти не задерживаются.
      gcTime: 30 * 60_000,
      retry: 1,
    },
  },
});
