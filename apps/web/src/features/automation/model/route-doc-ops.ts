import type {
  FlowHandleId,
  FlowPoint,
  TransitionDisplay,
  WorkflowDraftDocument,
  WorkflowDraftTransition,
  WorkflowLayout,
  WorkflowLayoutTransition,
} from '@nodus/contracts';
import { flowHandleIdSchema, smartIntent } from '@nodus/contracts';

import { layoutRoute } from '../../../shared/flow/route-layout.js';
import { newId, normalize } from './route-doc-helpers.js';

/**
 * Чистые операции над документом маршрута (#378 ред. 2): структура и
 * ОБЩАЯ раскладка холста (`document.layout`, ADR-0022) меняются вместе —
 * один шаг истории отмены. Стор только применяет результат.
 */

export const EMPTY_LAYOUT: WorkflowLayout = { stages: {}, transitions: {} };

export function layoutOf(doc: WorkflowDraftDocument): WorkflowLayout {
  return doc.layout ?? EMPTY_LAYOUT;
}

/** Точка подключения из события холста (чужие id — без сохранения). */
export function handleIdOf(id: string | null | undefined): FlowHandleId | undefined {
  const parsed = flowHandleIdSchema.safeParse(id);
  return parsed.success ? parsed.data : undefined;
}

function withTransitionLayout(
  doc: WorkflowDraftDocument,
  id: string,
  patch: Partial<WorkflowLayoutTransition>,
): WorkflowDraftDocument {
  const layout = layoutOf(doc);
  const merged = Object.fromEntries(
    Object.entries({ ...layout.transitions[id], ...patch }).filter(([, v]) => v !== undefined),
  ) as WorkflowLayoutTransition;
  return { ...doc, layout: { ...layout, transitions: { ...layout.transitions, [id]: merged } } };
}

/** Без записей раскладки удалённых статусов и кнопок. */
export function pruneLayout(doc: WorkflowDraftDocument): WorkflowDraftDocument {
  if (!doc.layout) return doc;
  const stageIds = new Set(doc.stages.map((s) => s.id));
  const transitionIds = new Set(doc.transitions.map((t) => t.id));
  return {
    ...doc,
    layout: {
      stages: Object.fromEntries(
        Object.entries(doc.layout.stages).filter(([id]) => stageIds.has(id)),
      ),
      transitions: Object.fromEntries(
        Object.entries(doc.layout.transitions).filter(([id]) => transitionIds.has(id)),
      ),
    },
  };
}

export function setStagePosition(
  doc: WorkflowDraftDocument,
  id: string,
  position: FlowPoint,
): WorkflowDraftDocument {
  const layout = layoutOf(doc);
  const point = { x: Math.round(position.x), y: Math.round(position.y) };
  return { ...doc, layout: { ...layout, stages: { ...layout.stages, [id]: point } } };
}

export function setLabelT(
  doc: WorkflowDraftDocument,
  id: string,
  t: number,
): WorkflowDraftDocument {
  return withTransitionLayout(doc, id, {
    labelT: Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000,
  });
}

export function setAnyAnchor(
  doc: WorkflowDraftDocument,
  id: string,
  anchor: FlowPoint,
): WorkflowDraftDocument {
  return withTransitionLayout(doc, id, {
    anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) },
  });
}

/** Новая кнопка: имя — имя цели, видят исполнители (как прежний addTransition). */
function newTransition(
  doc: WorkflowDraftDocument,
  from: string | null,
  to: string,
  name: string,
): WorkflowDraftTransition {
  return {
    id: newId(),
    code: null,
    name,
    fromStageId: from,
    toStageId: to,
    display: 'button',
    intent: smartIntent(doc.stages.find((s) => s.id === to)),
    sortOrder: Math.max(0, ...doc.transitions.map((t) => t.sortOrder)) + 1,
    rules: {
      conditions: [{ kind: 'role_in', roles: ['assignee'] }],
      validators: [],
      postFunctions: [],
    },
    form: { enabled: false, sections: [] },
  };
}

/** Соединение двух статусов с выбранными точками (петля и чужие узлы — нет). */
export function connect(
  doc: WorkflowDraftDocument,
  from: string,
  to: string,
  handles: { sourceHandle?: FlowHandleId; targetHandle?: FlowHandleId } = {},
): { doc: WorkflowDraftDocument; id: string } | null {
  const source = doc.stages.find((s) => s.id === from);
  const target = doc.stages.find((s) => s.id === to);
  if (!source || !target || from === to) return null;
  const transition = newTransition(doc, from, to, target.name);
  const next = { ...doc, transitions: [...doc.transitions, transition] };
  const hasHandles = handles.sourceHandle !== undefined || handles.targetHandle !== undefined;
  return {
    doc: hasHandles ? withTransitionLayout(next, transition.id, handles) : next,
    id: transition.id,
  };
}

/**
 * Перенос конца стрелки. У кнопки «из любого статуса» меняется только цель
 * (источника нет); у обычной — оба конца и их точки. Петля — отказ.
 */
export function reconnect(
  doc: WorkflowDraftDocument,
  id: string,
  connection: {
    source: string;
    target: string;
    sourceHandle?: FlowHandleId;
    targetHandle?: FlowHandleId;
  },
): WorkflowDraftDocument | null {
  const transition = doc.transitions.find((t) => t.id === id);
  if (!transition || !doc.stages.some((s) => s.id === connection.target)) return null;
  const any = transition.fromStageId === null;
  const from = any ? null : connection.source;
  if (!any && (from === connection.target || !doc.stages.some((s) => s.id === from))) return null;
  const transitions = doc.transitions.map((t) =>
    t.id === id ? { ...t, fromStageId: from, toStageId: connection.target } : t,
  );
  // Ручной сдвиг участка относился к прежней форме стрелки — сбрасывается.
  return withTransitionLayout({ ...doc, transitions }, id, {
    ...(any ? {} : { sourceHandle: connection.sourceHandle }),
    targetHandle: connection.targetHandle,
    shift: undefined,
  });
}

/**
 * Свободный участок стрелки отодвинули (#395): `shift` — «ступенька» и обход
 * «за спиной», `offset` — глубина U-обхода; `null` — вернуть авто.
 */
export function setEdgeBend(
  doc: WorkflowDraftDocument,
  id: string,
  param: 'shift' | 'offset',
  value: number | null,
): WorkflowDraftDocument {
  return withTransitionLayout(doc, id, { [param]: value === null ? undefined : Math.round(value) });
}

/** «Можно перейти из любого статуса»: вкл — кнопка с именем статуса, выкл —
 *  все такие кнопки в статус уходят вместе с их метками. */
export function toggleAny(
  doc: WorkflowDraftDocument,
  stageId: string,
  on: boolean,
): { doc: WorkflowDraftDocument; id: string | null } {
  const stage = doc.stages.find((s) => s.id === stageId);
  if (!stage) return { doc, id: null };
  if (!on) {
    const transitions = doc.transitions.filter(
      (t) => !(t.fromStageId === null && t.toStageId === stageId),
    );
    return { doc: pruneLayout({ ...doc, transitions }), id: null };
  }
  if (doc.transitions.some((t) => t.fromStageId === null && t.toStageId === stageId)) {
    return { doc, id: null };
  }
  const transition = newTransition(doc, null, stageId, stage.name);
  return { doc: { ...doc, transitions: [...doc.transitions, transition] }, id: transition.id };
}

/** «Упорядочить»: авторасстановка пишется в раскладку целиком, ручные точки
 *  подключения, подписи и метки сбрасываются (рёбра проложатся заново). */
export function arrange(doc: WorkflowDraftDocument): WorkflowDraftDocument {
  const auto = layoutRoute(doc.stages, doc.transitions);
  const stages: WorkflowLayout['stages'] = {};
  for (const [id, entry] of auto) stages[id] = { x: entry.x, y: entry.y };
  return { ...doc, layout: { stages, transitions: {} } };
}

/** Удаление статусов и кнопок одним шагом (кнопки удалённых статусов — тоже). */
export function removeElements(
  doc: WorkflowDraftDocument,
  stageIds: readonly string[],
  transitionIds: readonly string[],
): WorkflowDraftDocument {
  const stages = new Set(stageIds);
  const transitions = new Set(transitionIds);
  return pruneLayout({
    ...doc,
    stages: doc.stages.filter((s) => !stages.has(s.id)),
    transitions: doc.transitions.filter(
      (t) =>
        !transitions.has(t.id) &&
        !stages.has(t.toStageId) &&
        !(t.fromStageId !== null && stages.has(t.fromStageId)),
    ),
  });
}

/** Порядок статуса внутри его группы (sortOrder — индекс в группе). */
export function moveStage(
  doc: WorkflowDraftDocument,
  id: string,
  targetIndex: number,
): WorkflowDraftDocument | null {
  const stage = doc.stages.find((st) => st.id === id);
  if (!stage) return null;
  const peers = doc.stages.filter((st) => st.systemState === stage.systemState && st.id !== id);
  peers.splice(Math.max(0, Math.min(peers.length, targetIndex)), 0, { ...stage });
  const byId = new Map(peers.map((st) => [st.id, st]));
  return normalize({ ...doc, stages: doc.stages.map((st) => byId.get(st.id) ?? st) });
}

/** Порядок кнопок внутри статуса (sortOrder переназначается группе). */
export function moveTransition(
  doc: WorkflowDraftDocument,
  id: string,
  targetIndex: number,
): WorkflowDraftDocument | null {
  const target = doc.transitions.find((t) => t.id === id);
  if (!target) return null;
  const group = doc.transitions
    .filter((t) => t.fromStageId === target.fromStageId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const from = group.indexOf(target);
  const to = Math.max(0, Math.min(group.length - 1, targetIndex));
  if (from === to) return null;
  group.splice(to, 0, ...group.splice(from, 1));
  const order = new Map(group.map((t, i) => [t.id, i]));
  return {
    ...doc,
    transitions: doc.transitions.map((t) =>
      order.has(t.id) ? { ...t, sortOrder: order.get(t.id)! } : t,
    ),
  };
}

/** Главная кнопка статуса — одна: прежняя главная становится «Кнопкой». */
export function setTransitionPrimary(
  doc: WorkflowDraftDocument,
  id: string,
): WorkflowDraftDocument | null {
  const target = doc.transitions.find((t) => t.id === id);
  if (!target) return null;
  const transitions = doc.transitions.map((t) => {
    if (t.id === id) return { ...t, display: 'primary' as TransitionDisplay };
    if (t.display === 'primary' && t.fromStageId === target.fromStageId) {
      return { ...t, display: 'button' as TransitionDisplay };
    }
    return t;
  });
  return { ...doc, transitions };
}
