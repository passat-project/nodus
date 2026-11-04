import { useQuery } from '@tanstack/react-query';
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

/** Загрузка одного маршрута (queryFn реестра и префетча меты списка типов). */
export function fetchWorkflowDetail(workflowId: string): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(`/workflows/${workflowId}`);
}

/** Документ маршрута типа процесса (редактор и «Схема маршрута»). */
export function useWorkflowDetail(workflowId: string | null) {
  return useQuery({
    queryKey: workflowKeys.detail(workflowId ?? 'none'),
    queryFn: () => fetchWorkflowDetail(workflowId!),
    enabled: workflowId !== null,
    staleTime: 30_000,
  });
}
