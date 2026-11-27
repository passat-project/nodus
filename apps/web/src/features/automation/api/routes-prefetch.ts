import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProcessType } from '@nodus/contracts';

import { workflowDetailOptions } from '../../../shared/workflow/workflow-api.js';

/** Потолок предзагрузки: при сотне типов волна запросов отняла бы канал у
 *  открытого выбора — дальше потолка маршрут придёт по выбору, как раньше. */
export const ROUTE_PREFETCH_LIMIT = 40;
/** Простой может не наступить под непрерывным вводом — грузим не позже. */
const IDLE_TIMEOUT_MS = 2_000;

/**
 * Маршруты живых типов — в кэш, пока сотрудник читает колонку (#857, К4).
 * Первый выбор после перезагрузки открывался пустым «Маршрутом»: запрос шёл
 * только с выбором, и граф вспыхивал на месте уже стоящей рамы. Теперь к
 * моменту выбора маршрут на руках и рама появляется сразу с графом.
 *
 * Грузим в свободное время — запросы открытого выбора идут без конкуренции за
 * канал. Отказ глотается (`prefetchQuery` не бросает): выбранный тип спросит
 * маршрут сам. Свежие маршруты (в пределах staleTime) не перезапрашиваются.
 */
export function usePrefetchRoutes(types: readonly ProcessType[]) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const load = () => {
      for (const type of types.slice(0, ROUTE_PREFETCH_LIMIT)) {
        void queryClient.prefetchQuery(workflowDetailOptions(type.workflowId));
      }
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(load, { timeout: IDLE_TIMEOUT_MS });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [types, queryClient]);
}
