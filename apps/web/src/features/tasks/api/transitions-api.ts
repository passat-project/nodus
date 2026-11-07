import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type {
  ExecuteTransitionBody,
  ExecuteTransitionResult,
  TaskDetail,
  TaskListItem,
  TaskStage,
  WorkflowTransition,
  TransitionBlockReason,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api, ApiError } from '../../../shared/api-client.js';
import { markFreshFromMutation } from '../../../shared/api/fresh-from-mutation.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { mapTaskInPages, tasksKeys } from '../../../shared/api/tasks-keys.js';
import { transitionErrorText } from '../../../shared/tasks/transition-error.js';

export { gateReasonsText, transitionErrorText } from '../../../shared/tasks/transition-error.js';

/** Доступные текущему пользователю переходы маршрута (ADR-0020): кнопки бара
 *  и список поля «Стадия» — сервер решает, кому какие (условия «кто»).
 *  Свежесть держат ответ кнопки и WS-события — без рефетча на каждый маунт. */
export function useWorkflowTransitions(taskId: string) {
  return useQuery({
    queryKey: tasksKeys.transitions(taskId),
    queryFn: () => api<WorkflowTransition[]>(`/tasks/${taskId}/transitions`),
    staleTime: 30_000,
  });
}

/** Стадия-цель кнопки — из самой кнопки (цвет/порядок в DTO): чип меняется
 *  мгновенно и без каталога стадий в кэше. */
function stageOf(t: WorkflowTransition, current: TaskStage): TaskStage {
  return {
    ...current,
    id: t.toStageId,
    name: t.toStageName,
    order: t.toStageOrder,
    systemState: t.toStageState,
    color: t.toStageColor,
    outcome: t.toStageOutcome,
  };
}

function patchTask(queryClient: QueryClient, taskId: string, patch: Partial<TaskListItem>) {
  queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), (prev) =>
    prev ? { ...prev, ...patch } : prev,
  );
  queryClient.setQueriesData({ queryKey: tasksKeys.listPages() }, (data) =>
    mapTaskInPages(data as Parameters<typeof mapTaskInPages>[0], taskId, (t) => ({
      ...t,
      ...patch,
    })),
  );
}

/** Ошибка окна перехода для показа внутри окна (422 — недостающие разделы,
 *  409 — причины гейтов). Остальное — тостом, окно остаётся открытым. */
export function transitionWindowError(
  error: unknown,
): { missing?: string[]; reasons?: TransitionBlockReason[] } | null {
  if (!(error instanceof ApiError)) return null;
  const missing = error.details?.missing;
  const reasons = error.details?.reasons;
  if (error.code === 'WORKFLOW_TRANSITION_FORM_INVALID' && Array.isArray(missing)) {
    return { missing: missing.filter((m): m is string => typeof m === 'string') };
  }
  if (error.code === 'WORKFLOW_TRANSITION_BLOCKED' && Array.isArray(reasons)) {
    return { reasons: reasons as TransitionBlockReason[] };
  }
  return null;
}

/**
 * Выполнение перехода из окна (#380, Р7): ПЕССИМИСТИЧНАЯ отправка — без
 * `onMutate`; окно ждёт ответа сервера. Окно собирает данные, решает сервер:
 * оптимистичное закрытие с последующей ошибкой потеряло бы ввод. Один
 * `Idempotency-Key` на попытку (ref): повтор после обрыва сети не задвоит
 * запись времени, ревизию итога и строку журнала.
 */
export function useSubmitTransitionWindow(taskId: string) {
  const queryClient = useQueryClient();
  const idempotencyKey = useRef<string | null>(null);
  return useMutation({
    mutationFn: (vars: { transition: WorkflowTransition; body: ExecuteTransitionBody }) => {
      idempotencyKey.current ??= crypto.randomUUID();
      return api<ExecuteTransitionResult>(`/tasks/${taskId}/transitions/${vars.transition.id}`, {
        method: 'POST',
        body: vars.body,
        idempotencyKey: idempotencyKey.current,
      });
    },
    onSuccess: (result) => {
      idempotencyKey.current = null;
      markFreshFromMutation(taskId);
      patchTask(queryClient, taskId, result.task);
      queryClient.setQueryData(tasksKeys.transitions(taskId), result.transitions);
      void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.timeEntries(taskId) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.transitions(taskId) });
      // Агрегаты узлов дерева (#467): прогресс/часы/сроки пересчитываются
      // сервером на чтение — дерево перезапрашивается сразу, не по WS-эху.
      void queryClient.invalidateQueries({ queryKey: projectsKeys.structures() });
      for (const key of [
        tasksKeys.listPages(),
        tasksKeys.kanbanAll(),
        tasksKeys.personalStages(),
      ]) {
        void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
      }
    },
    onError: (error) => {
      // Окно остаётся открытым: 422/409 показывает строки внутри, остальное —
      // тостом. Ключ попытки не сбрасываем — повтор идёт с тем же ключом.
      if (!transitionWindowError(error)) toast.error(transitionErrorText(error));
    },
  });
}

/** Выполнение перехода (I4): чип стадии и строка журнала меняются сразу;
 *  ответ сервера несёт строку задачи и НОВЫЕ кнопки — панель процесса
 *  обновляется одним ходом, без повторного GET. Доски/счётчики догоняет
 *  WS-эхо события (один пакет); здесь они только помечаются устаревшими. */
export function useExecuteTransition(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transition: WorkflowTransition; override?: boolean; reason?: string }) =>
      api<ExecuteTransitionResult>(`/tasks/${taskId}/transitions/${vars.transition.id}`, {
        method: 'POST',
        body: { override: vars.override, reason: vars.reason },
      }),
    onMutate: async ({ transition }) => {
      // Свежесть — с момента отправки: WS-эхо события может обогнать HTTP-ответ
      // (замер при 150 мс сети: эхо раньше ответа → лишний GET детали и кнопок).
      markFreshFromMutation(taskId);
      await queryClient.cancelQueries({ queryKey: tasksKeys.detail(taskId) });
      const previous = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      if (previous) patchTask(queryClient, taskId, { stage: stageOf(transition, previous.stage) });
      return { previous };
    },
    onSuccess: (result) => {
      markFreshFromMutation(taskId);
      patchTask(queryClient, taskId, result.task);
      queryClient.setQueryData(tasksKeys.transitions(taskId), result.transitions);
      // Тост с номером — письменный паттерн (#630, Р6): «Присвоен номер …».
      if (result.assignedNumber) {
        toast.success(`${ui.tasks.assignedNumberToast} ${result.assignedNumber}`);
      }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) patchTask(queryClient, taskId, { stage: context.previous.stage });
      toast.error(transitionErrorText(error));
    },
    onSettled: (_result, error) => {
      if (error) {
        void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(taskId) });
        void queryClient.invalidateQueries({ queryKey: tasksKeys.transitions(taskId) });
      }
      // Без немедленного рефетча: активные доски и журнал перезапросит
      // WS-эхо одним пакетом, остальное — при следующем открытии.
      for (const key of [
        tasksKeys.listPages(),
        tasksKeys.kanbanAll(),
        tasksKeys.personalStages(),
      ]) {
        void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
      }
      // Дерево структуры (#467) — сразу: прогресс узла обязан обновиться без
      // перезагрузки страницы, даже если WS-эхо задержалось.
      void queryClient.invalidateQueries({ queryKey: projectsKeys.structures() });
    },
  });
}
