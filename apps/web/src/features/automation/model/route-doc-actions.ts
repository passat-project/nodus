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

/** Порядок действий внутри статуса (sortOrder переназначается группе). */
export function moveAction(
  doc: WorkflowDraftDocument,
  id: string,
  targetIndex: number,
): WorkflowDraftDocument | null {
  const actions = doc.actions ?? [];
  const target = actions.find((a) => a.id === id);
  if (!target) return null;
  const group = actions
    .filter((a) => a.stageId === target.stageId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const from = group.indexOf(target);
  const to = Math.max(0, Math.min(group.length - 1, targetIndex));
  if (from === to) return null;
  group.splice(to, 0, ...group.splice(from, 1));
  const order = new Map(group.map((a, i) => [a.id, i]));
  return {
    ...doc,
    actions: actions.map((a) => (order.has(a.id) ? { ...a, sortOrder: order.get(a.id)! } : a)),
  };
}

/** Главное действие статуса — одно: прежнее главное становится «Кнопкой». */
export function setActionPrimary(
  doc: WorkflowDraftDocument,
  id: string,
): WorkflowDraftDocument | null {
  const actions = doc.actions ?? [];
  const target = actions.find((a) => a.id === id);
  if (!target) return null;
  return {
    ...doc,
    actions: actions.map((a) => {
      if (a.id === id) return { ...a, display: 'primary' as const };
      if (a.display === 'primary' && a.stageId === target.stageId) {
        return { ...a, display: 'button' as const };
      }
      return a;
    }),
  };
}

/** Сигнатуры операций стора (вынесены ради лимита размера файла). */
export interface RouteDocActionOps {
  addAction: (stageId: string | null) => string;
  patchAction: (id: string, patch: Partial<Omit<WorkflowDraftAction, 'id' | 'sortOrder'>>) => void;
  removeAction: (id: string) => void;
  moveAction: (id: string, targetIndex: number) => void;
  setActionPrimary: (id: string) => void;
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
    moveAction: (id, targetIndex) => {
      const next = moveAction(getDocument(), id, targetIndex);
      if (next) commitDoc(next);
    },
    setActionPrimary: (id) => {
      const next = setActionPrimary(getDocument(), id);
      if (next) commitDoc(next);
    },
  };
}
