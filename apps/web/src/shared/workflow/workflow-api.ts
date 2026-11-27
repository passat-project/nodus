import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { WorkflowDetail } from '@nodus/contracts';

import { api } from '../api-client.js';

/** Ключи маршрутов процессов (#378, #428): документ + версия + счётчики
 *  сущностей по статусам. Живут в shared: потребитель «Схема маршрута»
 *  (shared/workflow) и фича «Автоматизация» — один кэш. */
export const workflowKeys = {
  all: ['workflows'] as const,
  detail: (id: string) => [...workflowKeys.all, 'detail', id] as const,
  /** Подсказки имён статусов (#430): категория + исключённый маршрут. */
  stageNames: (category: string, excludeWorkflowId: string) =>
    [...workflowKeys.all, 'stage-names', category, excludeWorkflowId] as const,
};

export function fetchWorkflowDetail(workflowId: string): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(`/workflows/${workflowId}`);
}

/** Маршрут одного процесса — ключ и загрузка. Один объект и для запроса
 *  (`useWorkflowDetail`), и для предзагрузки: кэш общий, срок свежести — тот же. */
export const workflowDetailOptions = (workflowId: string) =>
  queryOptions({
    queryKey: workflowKeys.detail(workflowId),
    queryFn: () => fetchWorkflowDetail(workflowId),
    staleTime: 30_000,
  });

/** Документ маршрута типа процесса (редактор и «Схема маршрута»). */
export function useWorkflowDetail(
  workflowId: string | null,
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
) {
  return useQuery({
    ...workflowDetailOptions(workflowId ?? 'none'),
    enabled: workflowId !== null,
    // Прежний маршрут остаётся на руках, пока грузится следующий: рама
    // «Процессов» при смене типа не пустеет. Что показывать с прежними
    // данными, решает вызывающий — сам запрос ничего не рисует.
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });
}
