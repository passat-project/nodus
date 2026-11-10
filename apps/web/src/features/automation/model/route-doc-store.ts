import { create } from 'zustand';
import type {
  CreationForm,
  FlowPoint,
  TaskSystemState,
  WorkflowDetail,
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowDraftTransition,
  WorkflowLayout,
} from '@nodus/contracts';
import { smartIntent, ui } from '@nodus/contracts';
import { clearDraft, persistDraft } from './route-draft-storage.js';
import {
  newId,
  normalize,
  stepHistory,
  structureChanged,
  withHistory,
} from './route-doc-helpers.js';
import * as ops from './route-doc-ops.js';
import { createActionOps, type RouteDocActionOps } from './route-doc-actions.js';
import { freezeLayout, settleLabels, settleLoops } from './route-doc-layout.js';
import { adoptedLayoutState, loadedState } from './route-doc-load.js';

/** Стор рабочей копии маршрута (#378, ADR-0021): документ (статусы, кнопки
 *  и ОБЩАЯ раскладка холста — ред. 2, ADR-0022), история-снимки, черновик в
 *  localStorage (route-draft-storage), публикация/отмена → сброс dirty.
 *  `dirty` — только правки МАРШРУТА: расстановка холста сохраняется сама
 *  (use-layout-autosave, без новой версии). Перетаскивание на холсте живёт
 *  локально в React Flow; в документ — одним шагом истории на отпускании. */

import type { CanvasConnection, SelectionRef } from './route-doc-types.js';

export type { CanvasConnection, SelectionRef } from './route-doc-types.js';

interface RouteDocState extends RouteDocActionOps {
  workflowId: string;
  baseVersion: number;
  document: WorkflowDraftDocument;
  /** Снимок опубликованной версии (сброс dirty = вернуть его). */
  baseline: WorkflowDraftDocument;
  selection: SelectionRef;
  /** Только что созданный статус/кнопка: панель ставит фокус в название. */
  freshId: string | null;
  /** Последняя правка текста (ввод названия): серия нажатий — один шаг отмены. */
  lastEdit: { key: string; at: number } | null;
  dirty: boolean;
  past: WorkflowDraftDocument[];
  future: WorkflowDraftDocument[];
  /** Когда черновик сохранён (баннер «Продолжить черновик от …»). */
  draftSavedAt: string | null;
  /** Устаревший черновик (версия ушла) — баннер «Черновик устарел». */
  staleDraftAt: string | null;
  /** Опубликовано, свежий документ сервера ещё не пришёл: правки закрыты —
   *  иначе вторая публикация повторила бы `new:*` статусы и кнопки. */
  pendingReload: boolean;

  load: (detail: WorkflowDetail) => void;
  /** Свежий документ сервера: перечитать, если сменились маршрут или версия
   *  (после публикации и после чужой публикации). */
  sync: (detail: WorkflowDetail) => void;
  select: (ref: SelectionRef) => void;

  /** Новый статус (по умолчанию — этап «В работе»), позиция — на холсте. */
  addStage: (band?: TaskSystemState, position?: FlowPoint) => string;
  patchStage: (id: string, patch: Partial<Omit<WorkflowDraftStage, 'id' | 'sortOrder'>>) => void;
  moveStage: (id: string, targetIndex: number) => void;
  removeStage: (id: string) => void;
  /** Позиция статуса — на отпускании перетаскивания (шаг истории). */
  setStagePosition: (id: string, position: FlowPoint) => void;

  addTransition: (from: string | null, to: string) => string | null;
  /** Соединение точек двух статусов на холсте. */
  connect: (connection: CanvasConnection) => string | null;
  /** Перенос конца стрелки (у «из любого» — только цель). */
  reconnect: (id: string, connection: CanvasConnection) => void;
  patchTransition: (
    id: string,
    patch: Partial<Omit<WorkflowDraftTransition, 'id' | 'sortOrder'>>,
  ) => void;
  setTransitionPrimary: (id: string) => void;
  removeTransition: (id: string) => void;
  moveTransition: (id: string, targetIndex: number) => void;
  /** Подпись вдоль стрелки (0 — у источника, 1 — у цели). */
  setLabelT: (id: string, t: number) => void;
  /** Метка «Любой статус» кнопки из любого статуса — место на холсте. */
  setAnyAnchor: (id: string, anchor: FlowPoint) => void;
  /** Свободный участок стрелки отодвинули (null — вернуть авто). */
  setEdgeBend: (id: string, param: 'shift' | 'offset', value: number | null) => void;
  /** «Можно перейти из любого статуса» в настройках статуса. */
  toggleAny: (stageId: string, on: boolean) => void;
  /** Удаление выделенного с холста (Delete) — одним шагом. */
  removeElements: (stageIds: readonly string[], transitionIds: readonly string[]) => void;

  /** Форма создания типа (#432, В1): раздел документа, `null` — умолчание.
   *  Правки формы — шаг истории и черновик, как у статусов и кнопок;
   *  `coalesce` — ключ серии правок одного поля (ввод скрытого значения):
   *  нажатия подряд — один шаг отмены, а не «по букве». */
  setCreationForm: (form: CreationForm | null, coalesce?: string) => void;

  /** «Упорядочить»: авторасстановка в раскладку (шаг истории). */
  arrange: () => void;
  undo: () => void;
  redo: () => void;
  discard: () => void;
  /** Публикация прошла: черновик снят, правки закрыты до sync() свежей
   *  версии (baseVersion — только из документа сервера). */
  markPublished: () => void;
  /** Расстановка автосохранена (PUT .../layout) — ответ сервера. */
  markLayoutSaved: (layout: WorkflowLayout) => void;
}

/** Фабрика стора на маршрут (черновик персистится на каждый документ-шаг). */
export function createRouteDocStore(workflowId: string) {
  return create<RouteDocState>()((set, get) => {
    /** Шаг документа: история + черновик (без шага — если операция отказала).
     *  `coalesce` — ключ ввода текста: нажатия подряд (< 1 с) сливаются в
     *  один шаг отмены, а не «по букве». `freeze` — видимая расстановка
     *  фиксируется, сдвинутые обходы не слипаются с соседними, подписи не
     *  наезжают на узлы и друг на друга (выключено только у «Упорядочить»). */
    const commit = (
      proposed: WorkflowDraftDocument | null,
      extra: Partial<RouteDocState> = {},
      coalesce?: string,
      freeze = true,
    ) => {
      if (!proposed) return;
      const prev = get().document;
      const next = freeze
        ? settleLabels(prev, settleLoops(prev, freezeLayout(prev, proposed)))
        : proposed;
      const now = Date.now();
      set((s) => {
        const merge =
          coalesce !== undefined && s.lastEdit?.key === coalesce && now - s.lastEdit.at < 1000;
        const history = merge
          ? { document: next, past: s.past, future: [], dirty: structureChanged(next, s.baseline) }
          : withHistory(s, next);
        return { ...history, ...extra, lastEdit: coalesce ? { key: coalesce, at: now } : null };
      });
      const s = get();
      set({ draftSavedAt: persistDraft(s.workflowId, s.document, s.baseVersion) });
    };
    /** Ключ слияния: правка только названия элемента. */
    const nameKey = (id: string, patch: object) =>
      Object.keys(patch).length === 1 && 'name' in patch ? `name:${id}` : undefined;
    const persist = () => {
      const s = get();
      set({ draftSavedAt: persistDraft(s.workflowId, s.document, s.baseVersion) });
    };
    const dropSelectionOf = (ids: ReadonlySet<string>) => {
      const selection = get().selection;
      return selection && selection.kind !== 'creation' && ids.has(selection.id) ? null : selection;
    };

    return {
      workflowId,
      baseVersion: 1,
      document: { stages: [], transitions: [], layout: ops.EMPTY_LAYOUT },
      baseline: { stages: [], transitions: [], layout: ops.EMPTY_LAYOUT },
      selection: null,
      freshId: null,
      lastEdit: null,
      dirty: false,
      past: [],
      future: [],
      draftSavedAt: null,
      staleDraftAt: null,
      pendingReload: false,

      load: (detail) => set(loadedState(detail)),

      sync: (detail) => {
        const s = get();
        if (s.workflowId !== detail.id || s.baseVersion !== detail.version) {
          s.load(detail);
          return;
        }
        const adopted = adoptedLayoutState(s, detail);
        if (adopted) set(adopted);
      },

      select: (ref) => set({ selection: ref, freshId: null }),

      addStage: (band = 'active', position) => {
        const id = newId();
        const doc = get().document;
        const stage: WorkflowDraftStage = {
          id,
          code: null,
          name: ui.automation.newStageName,
          color: 'neutral',
          systemState: band,
          outcome: band === 'closed' ? 'success' : null,
          isInitial: doc.stages.every((st) => !st.isInitial) && band === 'backlog',
          sortOrder: 0,
        };
        const next = normalize({ ...doc, stages: [...doc.stages, stage] });
        commit(position ? ops.setStagePosition(next, id, position) : next, {
          selection: { kind: 'stage', id },
          freshId: id,
        });
        return id;
      },

      patchStage: (id, patch) => {
        const doc = get().document;
        let touched = doc.stages.map((st) => (st.id === id ? { ...st, ...patch } : st));
        // Один начальный: включение переносит флаг с прежнего.
        if (patch.isInitial === true) {
          touched = touched.map((st) => ({ ...st, isInitial: st.id === id }));
        }
        commit(normalize({ ...doc, stages: touched }), {}, nameKey(id, patch));
      },

      moveStage: (id, targetIndex) => commit(ops.moveStage(get().document, id, targetIndex)),

      removeStage: (id) => get().removeElements([id], []),

      setStagePosition: (id, position) =>
        commit(ops.setStagePosition(get().document, id, position)),

      addTransition: (from, to) => {
        const doc = get().document;
        if (from === null) {
          const result = ops.toggleAny(doc, to, true);
          if (!result.id) return null;
          commit(result.doc, {
            selection: { kind: 'transition', id: result.id },
            freshId: result.id,
          });
          return result.id;
        }
        return get().connect({ source: from, target: to });
      },

      connect: ({ source, target, sourceHandle, targetHandle }) => {
        const result = ops.connect(get().document, source, target, { sourceHandle, targetHandle });
        if (!result) return null;
        commit(result.doc, {
          selection: { kind: 'transition', id: result.id },
          freshId: result.id,
        });
        return result.id;
      },

      reconnect: (id, connection) => commit(ops.reconnect(get().document, id, connection)),

      patchTransition: (id, patch) => {
        const doc = get().document;
        const current = doc.transitions.find((t) => t.id === id);
        let nextPatch = patch;
        // Умный дефолт (#430): смена цели пересчитывает смысл кнопки, только
        // если пользователь не выбрал его вручную (текущий равен дефолту
        // старой цели).
        if (current && patch.toStageId !== undefined && patch.toStageId !== current.toStageId) {
          const oldDefault = smartIntent(doc.stages.find((s) => s.id === current.toStageId));
          if ((patch.intent ?? current.intent) === oldDefault) {
            nextPatch = {
              ...patch,
              intent: smartIntent(doc.stages.find((s) => s.id === patch.toStageId)),
            };
          }
        }
        commit(
          {
            ...doc,
            transitions: doc.transitions.map((t) => (t.id === id ? { ...t, ...nextPatch } : t)),
          },
          {},
          nameKey(id, nextPatch),
        );
      },

      setTransitionPrimary: (id) => commit(ops.setTransitionPrimary(get().document, id)),

      ...createActionOps({
        getDocument: () => get().document,
        commitDoc: (doc, meta, coalesce) => commit(normalize(doc), meta ?? {}, coalesce),
        newName: ui.automation.newActionName,
      }),

      removeTransition: (id) => get().removeElements([], [id]),

      moveTransition: (id, targetIndex) =>
        commit(ops.moveTransition(get().document, id, targetIndex)),

      setLabelT: (id, t) => commit(ops.setLabelT(get().document, id, t)),

      setAnyAnchor: (id, anchor) => commit(ops.setAnyAnchor(get().document, id, anchor)),

      setEdgeBend: (id, param, value) => commit(ops.setEdgeBend(get().document, id, param, value)),

      toggleAny: (stageId, on) => {
        const result = ops.toggleAny(get().document, stageId, on);
        if (result.doc !== get().document) commit(result.doc);
      },

      setCreationForm: (form, coalesce) =>
        commit({ ...get().document, creation: form }, {}, coalesce),

      removeElements: (stageIds, transitionIds) => {
        if (stageIds.length === 0 && transitionIds.length === 0) return;
        const next = normalize(ops.removeElements(get().document, stageIds, transitionIds));
        const gone = new Set([
          ...stageIds,
          ...transitionIds,
          ...get()
            .document.transitions.filter((t) => !next.transitions.some((n) => n.id === t.id))
            .map((t) => t.id),
        ]);
        commit(next, { selection: dropSelectionOf(gone) });
      },

      arrange: () => commit(ops.arrange(get().document), {}, undefined, false),

      undo: () => {
        set((s) => {
          const previous = s.past.at(-1);
          if (!previous) return {};
          return {
            ...stepHistory(s, previous, s.past.slice(0, -1), [s.document, ...s.future]),
            lastEdit: null,
          };
        });
        persist();
      },

      redo: () => {
        set((s) => {
          const [next, ...rest] = s.future;
          if (!next) return {};
          return { ...stepHistory(s, next, [...s.past, s.document], rest), lastEdit: null };
        });
        persist();
      },

      discard: () => {
        set((s) => ({
          document: s.baseline,
          dirty: false,
          past: [],
          future: [],
          draftSavedAt: null,
          staleDraftAt: null,
          selection: null,
        }));
        clearDraft(get().workflowId);
      },

      markPublished: () => {
        // Документ остаётся на экране до свежей версии (без мигания холста),
        // но с `new:*` id — поэтому правки и повторная публикация закрыты.
        set((s) => ({
          baseline: s.document,
          dirty: false,
          past: [],
          future: [],
          draftSavedAt: null,
          staleDraftAt: null,
          selection: null,
          pendingReload: true,
        }));
        clearDraft(get().workflowId);
      },

      markLayoutSaved: (layout) => {
        // Сохранённая расстановка — новая точка «Сбросить»; история и
        // черновик маршрута не трогаются.
        set((s) => ({ baseline: { ...s.baseline, layout } }));
      },
    };
  });
}

/** Единственный экземпляр стора: редактор один на экран, смена типа — load(). */
export const useRouteDocStore = createRouteDocStore('pending');
