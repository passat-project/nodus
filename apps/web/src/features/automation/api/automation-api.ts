import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProcessTypeBody,
  ProcessCategory,
  PublishWorkflowBody,
  PublishWorkflowResult,
  SaveWorkflowLayoutResult,
  ProcessType,
  UpdateProcessTypeBody,
  UpdateProcessTypeConfigBody,
  WorkflowLayout,
  WorkflowStageName,
} from '@nodus/contracts';
import { typeConfigOf, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { automationKeys } from '../../../shared/api/automation-keys.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { workflowKeys } from '../../../shared/workflow/workflow-api.js';

export { automationKeys };

/** Библиотека типов процессов: живые (по умолчанию), с архивом или только
 *  архив; все категории — список группирует их по категориям. */
export function useProcessTypes(archived?: 'include' | 'only') {
  return useQuery({
    queryKey: automationKeys.types(archived),
    queryFn: () => {
      const search = archived ? `?archived=${archived}` : '';
      return api<ProcessType[]>(`/workflows/types${search}`);
    },
    staleTime: 60_000,
  });
}

/** Мягкий каталог имён статусов (#430): подсказки редактора; текущий
 *  маршрут исключён, системные (неопубликованные) маршруты не отдаются. */
export function useStageNames(
  category: ProcessCategory,
  excludeWorkflowId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: workflowKeys.stageNames(category, excludeWorkflowId),
    queryFn: () =>
      api<WorkflowStageName[]>(
        `/workflows/stage-names?category=${category}&excludeWorkflowId=${excludeWorkflowId}`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

/** Создание типа: тип + маршрут из основы (копия/простой), скрыт. */
export function useCreateProcessType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProcessTypeBody) =>
      api<ProcessType>('/workflows/types', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
    onError: () => toast.error(ui.common.saveError),
  });
}

/** Свойства типа сохраняются сразу (оптимистично, I4) и публикации не
 *  требуют — публикуется только маршрут. */
export function useUpdateProcessType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateProcessTypeBody }) =>
      api<ProcessType>(`/workflows/types/${vars.id}`, { method: 'PATCH', body: vars.body }),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: automationKeys.all });
      const lists = queryClient.getQueriesData<ProcessType[]>({ queryKey: automationKeys.all });
      const snapshots = lists.map(([key, data]) => ({
        key,
        data,
      }));
      for (const [key, data] of lists) {
        if (!data) continue;
        queryClient.setQueryData<ProcessType[]>(
          key,
          data.map((t) =>
            t.id === id ? { ...t, ...body, description: body.description ?? t.description } : t,
          ),
        );
      }
      return { snapshots };
    },
    onError: (_error, _vars, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      }
      toast.error(ui.common.saveError);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

/** Архив/возврат типа (системный — 409 на сервере). */
export function useArchiveProcessType(archive: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<ProcessType>(`/workflows/types/${id}/${archive ? 'archive' : 'restore'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
    onError: () => toast.error(ui.common.saveError),
  });
}

/** Публикация маршрута: версия + документ + обязательные переносы. */
export function usePublishWorkflow(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PublishWorkflowBody) =>
      api<PublishWorkflowResult>(`/workflows/${workflowId}/publish`, {
        method: 'POST',
        body,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: workflowKeys.all });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
      toast.success(
        result.scheduledMoves > 0 ? ui.automation.movingTasksToast : ui.automation.publishedToast,
      );
    },
  });
}

/** Расстановка холста — сразу на сервер, без новой версии маршрута
 *  (`PUT /workflows/:id/layout`, #378 ред. 2). */
export function saveWorkflowLayout(
  workflowId: string,
  layout: WorkflowLayout,
): Promise<SaveWorkflowLayoutResult> {
  return api<SaveWorkflowLayoutResult>(`/workflows/${workflowId}/layout`, {
    method: 'PUT',
    body: { layout },
  });
}

/**
 * Настройки типа (#432, Р11): разделы «Доступ» и «Карточка» (блоки,
 * названия ролей) заменяются целиком и сохраняются СРАЗУ — публикации требует только
 * маршрут. Оптимистично (I4): значение в кэше до ответа; мутации ОДНОГО типа
 * идут по очереди (`scope`), иначе два быстрых переключения перетирают
 * разделы друг друга.
 */
export function useUpdateProcessTypeConfig(typeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: `type-config:${typeId}` },
    mutationFn: (body: UpdateProcessTypeConfigBody) =>
      api<ProcessType>(`/workflows/types/${typeId}/config`, { method: 'PATCH', body }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: automationKeys.all });
      const lists = queryClient.getQueriesData<ProcessType[]>({ queryKey: automationKeys.all });
      const snapshots = lists.map(([key, data]) => ({ key, data }));
      for (const [key, data] of lists) {
        if (!data) continue;
        queryClient.setQueryData<ProcessType[]>(
          key,
          data.map((type) =>
            type.id === typeId
              ? {
                  ...type,
                  config: {
                    card: body.card ?? typeConfigOf(type).card,
                    access: body.access ?? typeConfigOf(type).access,
                  },
                }
              : type,
          ),
        );
      }
      return { snapshots };
    },
    onError: (_error, _body, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      }
      toast.error(ui.automation.typeSettings.saveError);
    },
    onSuccess: (type) => {
      const lists = queryClient.getQueriesData<ProcessType[]>({ queryKey: automationKeys.all });
      for (const [key, data] of lists) {
        if (!data) continue;
        queryClient.setQueryData<ProcessType[]>(
          key,
          data.map((entry) => (entry.id === type.id ? type : entry)),
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}
