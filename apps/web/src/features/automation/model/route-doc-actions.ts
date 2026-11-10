import type { WorkflowDraftAction, WorkflowDraftDocument } from '@nodus/contracts';

import { newId } from './route-doc-helpers.js';

/**
 * Действия маршрута (#633) — операции над документом черновика. Вынесены из
 * стора ради лимита размера файла (I5). Сами по себе операции чистые:
 * история, выделение и черновик — забота стора.
 */

/** Новое действие: окно включено (без окна и шагов публикация запрещена),
 *  «кто видит» — постановщик/исполнитель, как у кнопки-перехода. */
export function addAction(
  doc: WorkflowDraftDocument,
  stageId: string | null,
  name: string,
): { doc: WorkflowDraftDocument; id: string } {
  const id = newId();
  const action: WorkflowDraftAction = {
    id,
    code: null,
    name,
    stageId,
    display: 'button',
    sortOrder: 0,
    rules: {
      conditions: [{ kind: 'role_in', roles: ['assignee'] }],
      validators: [],
      postFunctions: [],
    },
    form: { enabled: true, sections: [] },
    steps: [],
  };
  return { doc: { ...doc, actions: [...(doc.actions ?? []), action] }, id };
}

export function patchAction(
  doc: WorkflowDraftDocument,
  id: string,
  patch: Partial<Omit<WorkflowDraftAction, 'id' | 'sortOrder'>>,
): WorkflowDraftDocument {
  return {
    ...doc,
    actions: (doc.actions ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
  };
}

export function removeAction(doc: WorkflowDraftDocument, id: string): WorkflowDraftDocument {
  return { ...doc, actions: (doc.actions ?? []).filter((a) => a.id !== id) };
}

/** Сигнатуры операций стора (вынесены ради лимита размера файла). */
export interface RouteDocActionOps {
  addAction: (stageId: string | null) => string;
  patchAction: (id: string, patch: Partial<Omit<WorkflowDraftAction, 'id' | 'sortOrder'>>) => void;
  removeAction: (id: string) => void;
}

/** Операции стора одним объектом: стор добавляет их к состоянию. */
export function createActionOps(args: {
  getDocument: () => WorkflowDraftDocument;
  commitDoc: (
    doc: WorkflowDraftDocument,
    meta?: { selection?: { kind: 'action'; id: string }; freshId?: string },
    coalesce?: string,
  ) => void;
  newName: string;
}): RouteDocActionOps {
  const { getDocument, commitDoc, newName } = args;
  return {
    addAction: (stageId) => {
      const result = addAction(getDocument(), stageId, newName);
      commitDoc(result.doc, { selection: { kind: 'action', id: result.id }, freshId: result.id });
      return result.id;
    },
    patchAction: (id, patch) => commitDoc(patchAction(getDocument(), id, patch), {}, id + ':name'),
    removeAction: (id) => commitDoc(removeAction(getDocument(), id)),
  };
}
