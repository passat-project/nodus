import { useCallback, useState } from 'react';
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
 * Ошибка превью НЕ блокирует перенос: значения пересчитает фоновый пересчёт
 * после мутации. Поэтому тост говорит о последствии («значения пересчитаются
 * после переноса»), а не о коде отказа: пользователь не теряет действие, и
 * «Не удалось выполнить действие» здесь читалось бы как отказ переноса.
 */

/** Тост деградации подсказки: перенос всё равно произойдёт. */
function previewFailed() {
  toast.error(ui.formulas.move.error);
}

/** Превью переноса папки: `parentId` — новый родитель (null — корень). */
export function useNodeMovePreview(projectId: string) {
  return useMutation({
    mutationFn: (vars: { nodeId: string; parentId: string | null }) =>
      api<FormulaMovePreviewResponse>(`/projects/${projectId}/nodes/${vars.nodeId}/move-preview`, {
        method: 'POST',
        body: { parentId: vars.parentId },
      }),
    onError: previewFailed,
  });
}

/** Превью переноса задачи: `nodeId` — новая папка (null — «Без папки»). */
export function useTaskMovePreview() {
  return useMutation({
    mutationFn: (vars: { taskId: string; nodeId: string | null }) =>
      api<FormulaMovePreviewResponse>(`/tasks/${vars.taskId}/move-preview`, {
        method: 'POST',
        body: { nodeId: vars.nodeId },
      }),
    onError: previewFailed,
  });
}

/** Строки диффа; ошибка превью = пустой дифф (тост уже показан хуком) —
 *  перенос выполняется, значения пересчитаются фоном. */
export async function movePreviewChanges(
  run: Promise<FormulaMovePreviewResponse>,
): Promise<FormulaMovePreviewResponse> {
  try {
    return await run;
  } catch {
    return { changes: [] };
  }
}

/** Ожидающий подтверждения перенос: дифф + действие, которое его выполнит. */
export interface PendingFormulaMove {
  changes: FormulaMovePreviewEntry[];
  /** Выборка обрезана: окно показывает не весь дифф. */
  truncated: boolean;
  apply: () => void;
}

/** Пропсы окна подтверждения — хост рендерит `FormulaMovePreviewDialog`. */
export interface FormulaMoveDialogProps {
  changes: readonly FormulaMovePreviewEntry[];
  truncated?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface FormulaMoveGate {
  /** Спросить подтверждение: дифф пуст — действие сразу, непуст — диалог. */
  offer: (run: Promise<FormulaMovePreviewResponse>, apply: () => void) => Promise<void>;
  /** Что ждёт подтверждения (null — диалога нет). */
  pending: PendingFormulaMove | null;
  confirm: () => void;
  cancel: () => void;
  /** Готовые пропсы окна: `<FormulaMovePreviewDialog {...gate.dialogProps} />`. */
  dialogProps: FormulaMoveDialogProps;
}

/**
 * Состояние подтверждения переноса для хоста со своей мутацией: папка
 * (`NodeMoveDialog`, DnD узла) и задача (DnD задачи) спрашивают одинаково —
 * «дифф непуст?» — и дальше зовут СВОЁ действие, поэтому хук не знает, что
 * именно переносится.
 */
export function useFormulaMoveGate(): FormulaMoveGate {
  const [pending, setPending] = useState<PendingFormulaMove | null>(null);

  const offer = useCallback(async (run: Promise<FormulaMovePreviewResponse>, apply: () => void) => {
    const response = await movePreviewChanges(run);
    if (response.changes.length === 0) apply();
    else setPending({ changes: response.changes, truncated: response.truncated ?? false, apply });
  }, []);

  const confirm = useCallback(() => {
    if (!pending) return;
    // Окно гаснет сразу (диалог — только подтверждение), действие уходит в
    // свою мутацию хоста; повторный клик невозможен — окна уже нет.
    const { apply } = pending;
    setPending(null);
    apply();
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return {
    offer,
    pending,
    confirm,
    cancel,
    dialogProps: {
      changes: pending?.changes ?? [],
      truncated: pending?.truncated ?? false,
      onConfirm: confirm,
      onCancel: cancel,
    },
  };
}
