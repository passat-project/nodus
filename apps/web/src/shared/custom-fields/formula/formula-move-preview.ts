import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { FormulaMovePreviewEntry, FormulaMovePreviewResponse } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../api-client.js';

/**
 * Превью переноса записи (#632, критерий 1, §4c): дифф формульных значений
 * ДО мутации — «что изменится, если перенести». Два маршрута: папка проекта
 * (`/projects/:id/nodes/:nodeId/move-preview`) и задача
 * (`/tasks/:id/move-preview`); сервер считает dry-run с подменой места и
 * отдаёт только видимые актору записи.
 *
 * Пачка (мультиселект, A9-1/A9-2) спрашивает то же превью по каждой записи и
 * складывает ответы в сводку (`previewMoveBatch`): раньше bulk-перенос уходил
 * в мутацию без подтверждения — человек не знал, что изменится, до записи.
 *
 * Ошибка превью НЕ блокирует перенос: значения пересчитает фоновый пересчёт
 * после мутации. Поэтому тост говорит о последствии («значения пересчитаются
 * после переноса»), а не о коде отказа: пользователь не теряет действие, и
 * «Не удалось выполнить действие» здесь читалось бы как отказ переноса.
 */

/** Тост деградации подсказки: перенос всё равно произойдёт. */
function previewFailed() {
  toast.error(ui.formulas.move.error);
}

/** Превью переноса папки без записи: `parentId` — новый родитель (null — корень). */
export function fetchNodeMovePreview(
  projectId: string,
  nodeId: string,
  parentId: string | null,
): Promise<FormulaMovePreviewResponse> {
  return api<FormulaMovePreviewResponse>(`/projects/${projectId}/nodes/${nodeId}/move-preview`, {
    method: 'POST',
    body: { parentId },
  });
}

/** Превью переноса задачи без записи: `nodeId` — новая папка (null — «Без папки»). */
export function fetchTaskMovePreview(
  taskId: string,
  nodeId: string | null,
): Promise<FormulaMovePreviewResponse> {
  return api<FormulaMovePreviewResponse>(`/tasks/${taskId}/move-preview`, {
    method: 'POST',
    body: { nodeId },
  });
}

/** Превью переноса папки: `parentId` — новый родитель (null — корень). */
export function useNodeMovePreview(projectId: string) {
  return useMutation({
    mutationFn: (vars: { nodeId: string; parentId: string | null }) =>
      fetchNodeMovePreview(projectId, vars.nodeId, vars.parentId),
    onError: previewFailed,
  });
}

/** Превью переноса задачи: `nodeId` — новая папка (null — «Без папки»). */
export function useTaskMovePreview() {
  return useMutation({
    mutationFn: (vars: { taskId: string; nodeId: string | null }) =>
      fetchTaskMovePreview(vars.taskId, vars.nodeId),
    onError: previewFailed,
  });
}

/** Ответ превью переноса. У пачки (`previewMoveBatch`) заполнены `previewed`
 *  и `total`: окно говорит, по скольким записям сводка собрана. */
export interface MovePreviewSummary extends FormulaMovePreviewResponse {
  /** Записей, по которым дифф получен (ошибка одной записи счёт уменьшает). */
  previewed?: number;
  /** Всего записей в пачке. */
  total?: number;
}

/** Строки диффа; ошибка превью = пустой дифф (тост уже показан хуком) —
 *  перенос выполняется, значения пересчитаются фоном. */
export async function movePreviewChanges(
  run: Promise<MovePreviewSummary>,
): Promise<MovePreviewSummary> {
  try {
    return await run;
  } catch {
    return { changes: [] };
  }
}

/** Потолок пачки: столько dry-run'ов спрашиваем перед массовым переносом.
 *  Дальше сводка перестаёт читаться, а сервер получает очередь запросов —
 *  окно честно говорит «показаны изменения по 20 из 87 записей». */
export const BULK_PREVIEW_LIMIT = 20;

/**
 * Сводный дифф пачки (A9-1/A9-2): превью спрашивается по каждой записи
 * (первые `BULK_PREVIEW_LIMIT`), ответы складываются в один список «было →
 * станет». Ошибка отдельной записи не отменяет сводку и не блокирует перенос:
 * как и одиночный путь, пачка переносится, значения пересчитает фон. Тост
 * деградации — ОДИН на пачку, а не на запись (иначе 20 dry-run'ов дают 20
 * одинаковых тостов).
 */
export async function previewMoveBatch(
  ids: readonly string[],
  fetchPreview: (id: string) => Promise<FormulaMovePreviewResponse>,
): Promise<MovePreviewSummary> {
  const asked = ids.slice(0, BULK_PREVIEW_LIMIT);
  const results = await Promise.allSettled(asked.map((id) => fetchPreview(id)));
  const changes: FormulaMovePreviewEntry[] = [];
  let previewed = 0;
  // Обрезка потолком — уже повод сказать «изменения не все».
  let truncated = ids.length > asked.length;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    previewed += 1;
    if (result.value.truncated) truncated = true;
    changes.push(...result.value.changes);
  }
  if (previewed < asked.length) {
    truncated = true;
    previewFailed();
  }
  return { changes, truncated, previewed, total: ids.length };
}

/** Сводный дифф пачки задач → папка (`null` — «Без папки»). */
export function previewTaskMoveBatch(
  taskIds: readonly string[],
  nodeId: string | null,
): Promise<MovePreviewSummary> {
  return previewMoveBatch(taskIds, (taskId) => fetchTaskMovePreview(taskId, nodeId));
}

/** Сводный дифф пачки папок → родитель (`null` — корень проекта). */
export function previewNodeMoveBatch(
  projectId: string,
  nodeIds: readonly string[],
  parentId: string | null,
): Promise<MovePreviewSummary> {
  return previewMoveBatch(nodeIds, (nodeId) => fetchNodeMovePreview(projectId, nodeId, parentId));
}

/** Ожидающий подтверждения перенос: дифф + действие, которое его выполнит. */
export interface PendingFormulaMove {
  changes: FormulaMovePreviewEntry[];
  /** Выборка обрезана: окно показывает не весь дифф. */
  truncated: boolean;
  /** Пачка: по скольким записям собрана сводка (одиночный перенос — пусто). */
  previewed?: number;
  /** Пачка: сколько записей всего. */
  total?: number;
  apply: () => void;
}

/** Пропсы окна подтверждения — хост рендерит `FormulaMovePreviewDialog`. */
export interface FormulaMoveDialogProps {
  changes: readonly FormulaMovePreviewEntry[];
  truncated?: boolean;
  previewed?: number;
  total?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface FormulaMoveGate {
  /** Спросить подтверждение: дифф пуст — действие сразу, непуст — диалог. */
  offer: (run: Promise<MovePreviewSummary>, apply: () => void) => Promise<void>;
  /** Что ждёт подтверждения (null — диалога нет). */
  pending: PendingFormulaMove | null;
  confirm: () => void;
  cancel: () => void;
  /** Готовые пропсы окна: `<FormulaMovePreviewDialog {...gate.dialogProps} />`. */
  dialogProps: FormulaMoveDialogProps;
}

/**
 * Состояние подтверждения переноса для хоста со своей мутацией: папка
 * (`NodeMoveDialog`, DnD узла) и задача (DnD задачи, меню, мультиселект)
 * спрашивают одинаково — «дифф непуст?» — и дальше зовут СВОЁ действие,
 * поэтому хук не знает, что именно переносится.
 */
export function useFormulaMoveGate(): FormulaMoveGate {
  const [pending, setPending] = useState<PendingFormulaMove | null>(null);
  // Зеркало pending для СИНХРОННОЙ проверки в offer: второй offer, пришедший
  // пока считается первый дифф или пока окно открыто, не должен затирать
  // первый — его apply терялся молча (A9-8: два DnD-дропа подряд оставляли
  // один перенос без подтверждения и без выполнения).
  const held = useRef<PendingFormulaMove | null>(null);
  const busy = useRef(false);

  const hold = useCallback((next: PendingFormulaMove | null) => {
    held.current = next;
    setPending(next);
  }, []);

  const offer = useCallback(
    async (run: Promise<MovePreviewSummary>, apply: () => void) => {
      // Один перенос подтверждается за раз: окно модальное, второй offer —
      // гонка (два дропа в одном кадре). Игнорируем его целиком: применить
      // оба всё равно нельзя, а «применить второй» потеряло бы первый дифф.
      if (busy.current || held.current) return;
      busy.current = true;
      try {
        const response = await movePreviewChanges(run);
        if (response.changes.length === 0) {
          apply();
          return;
        }
        hold({
          changes: response.changes,
          truncated: response.truncated ?? false,
          ...(response.total === undefined
            ? {}
            : { previewed: response.previewed ?? 0, total: response.total }),
          apply,
        });
      } finally {
        busy.current = false;
      }
    },
    [hold],
  );

  const confirm = useCallback(() => {
    const current = held.current;
    if (!current) return;
    // Окно гаснет сразу (диалог — только подтверждение), действие уходит в
    // свою мутацию хоста; повторный клик невозможен — окна уже нет.
    hold(null);
    current.apply();
  }, [hold]);

  const cancel = useCallback(() => hold(null), [hold]);

  return {
    offer,
    pending,
    confirm,
    cancel,
    dialogProps: {
      changes: pending?.changes ?? [],
      truncated: pending?.truncated ?? false,
      ...(pending?.total === undefined
        ? {}
        : { previewed: pending.previewed ?? 0, total: pending.total }),
      onConfirm: confirm,
      onCancel: cancel,
    },
  };
}
