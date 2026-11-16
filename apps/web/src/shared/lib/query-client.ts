import { QueryClient } from '@tanstack/react-query';

/**
 * Единственный клиент кэша запросов SPA. Живёт в shared, а не в app:
 * сброс сессии (`shared/session-reset.ts`) обязан очищать кэш при выходе и
 * смене аккаунта, а слою shared нельзя импортировать app (boundaries).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // I4: данные считаем свежими 30 с — без лишних фоновых перезапросов;
      // мутации инвалидируют ключи явно.
      staleTime: 30_000,
      retry: 1,
    },
  },
});
