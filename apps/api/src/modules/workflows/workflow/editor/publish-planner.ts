import type {
  WorkflowDocument,
  WorkflowMigration,
  WorkflowTransitionIntent,
} from '@nodus/contracts';

/**
 * Планировщик публикации маршрута (#378, ADR-0021) — чистая функция: снимок
 * живого маршрута + документ публикации → план изменений БД. Код клиента
 * не читается (сервер верит только своим кодам), uuid-ссылки документа
 * проверяются вызывающим на принадлежность маршруту. Unit-тестируется без БД.
 */

export interface PlannerStage {
  id: string;
  name: string;
  color: string;
  systemState: string;
  outcome: string | null;
  isInitial: boolean;
  sortOrder: number;
}

export interface PlannerTransition {
  id: string;
  name: string;
  fromStageId: string | null;
  toStageId: string;
  display: string;
  /** Смысл кнопки (#430). */
  intent?: WorkflowTransitionIntent;
  sortOrder: number;
  /** Разобранные правила (кто видит, условия, особые правила). */
  rules: unknown;
  /** Разобранная форма окна (#380): публикуется вместе с кнопкой. */
  form: unknown;
}

export interface PlannerSnapshot {
  stages: PlannerStage[];
  transitions: PlannerTransition[];
  /** Живые действия маршрута (#633). */
  actions: PlannerAction[];
  /** Живые задачи по стадиям (для обязательных переносов). */
  taskCounts: Record<string, number>;
}

/** Действие маршрута (#633): кнопка без смены статуса. */
export interface PlannerAction {
  id: string;
  name: string;
  /** null — «в любом статусе». */
  stageId: string | null;
  display: string;
  sortOrder: number;
  rules?: unknown;
  form: unknown;
  steps: unknown;
}

export interface StageCreate {
  docId: string;
  name: string;
  color: string;
  systemState: string;
  outcome: string | null;
  isInitial: boolean;
  sortOrder: number;
}

export interface StageUpdate {
  stageId: string;
  name: string;
  color: string;
  systemState: string;
  outcome: string | null;
  isInitial: boolean;
  sortOrder: number;
  /** Сменился этап — денормализация задач («Мой план» обновится). */
  restated: boolean;
}

export interface TransitionWrite {
  /** docId нового перехода (new:*) или uuid существующего. */
  id: string;
  name: string;
  fromStageId: string | null;
  toStageId: string;
  display: string;
  /** Смысл кнопки (#430): action | service. */
  intent: WorkflowTransitionIntent;
  sortOrder: number;
  /** Окно при нажатии (#380) — часть документа, пишется вместе с кнопкой. */
  form: unknown;
}

export interface ActionWrite {
  /** docId нового действия (new:*) или uuid существующего. */
  id: string;
  name: string;
  /** docId стадии, null — «любой статус» (в service мапится в uuid). */
  stageId: string | null;
  display: string;
  sortOrder: number;
  rules: unknown;
  form: unknown;
  steps: unknown;
}

export interface WorkflowPublishPlan {
  stageCreates: StageCreate[];
  stageUpdates: StageUpdate[];
  /** Архивируемые стадии с живыми задачами — обязателен перенос. */
  stageArchives: { stageId: string; name: string; taskCount: number }[];
  transitionCreates: TransitionWrite[];
  transitionUpdates: TransitionWrite[];
  transitionArchives: { transitionId: string }[];
  /** Действия (#633) — рядом с переходами. */
  actionCreates: ActionWrite[];
  actionUpdates: ActionWrite[];
  actionArchives: { actionId: string }[];
  /** Переносы задач (uuid стадии → docId цели, из body публикации). */
  moves: { fromStageId: string; toDocId: string }[];
  /** Стадии со сменой этапа (событие публикации, пересчёт денормализации). */
  restates: { stageId: string; systemState: string }[];
}

const isNew = (id: string): boolean => id.startsWith('new:');

/** План изменений: создать / обновить / архивировать. */
export function planWorkflowPublish(
  current: PlannerSnapshot,
  document: WorkflowDocument,
  migrations: readonly WorkflowMigration[],
): WorkflowPublishPlan {
  const currentStagesById = new Map(current.stages.map((s) => [s.id, s]));
  const currentTransitionsById = new Map(current.transitions.map((t) => [t.id, t]));

  const stageCreates: StageCreate[] = [];
  const stageUpdates: StageUpdate[] = [];
  const stageArchives: WorkflowPublishPlan['stageArchives'] = [];
  const restates: WorkflowPublishPlan['restates'] = [];

  for (const stage of document.stages) {
    const fields = {
      name: stage.name,
      color: stage.color,
      systemState: stage.systemState,
      outcome: stage.outcome,
      isInitial: stage.isInitial,
      sortOrder: stage.sortOrder,
    };
    if (isNew(stage.id) || !currentStagesById.has(stage.id)) {
      stageCreates.push({ docId: stage.id, ...fields });
      continue;
    }
    const existing = currentStagesById.get(stage.id)!;
    const restated = existing.systemState !== stage.systemState;
    const unchanged =
      existing.name === fields.name &&
      existing.color === fields.color &&
      existing.systemState === fields.systemState &&
      existing.outcome === fields.outcome &&
      existing.isInitial === fields.isInitial &&
      existing.sortOrder === fields.sortOrder;
    if (!unchanged) stageUpdates.push({ stageId: stage.id, ...fields, restated });
    if (restated) restates.push({ stageId: stage.id, systemState: stage.systemState });
  }

  const docStageIds = new Set(document.stages.map((s) => s.id));
  for (const stage of current.stages) {
    if (!docStageIds.has(stage.id)) {
      stageArchives.push({
        stageId: stage.id,
        name: stage.name,
        taskCount: current.taskCounts[stage.id] ?? 0,
      });
    }
  }

  const transitionCreates: TransitionWrite[] = [];
  const transitionUpdates: TransitionWrite[] = [];
  const transitionArchives: WorkflowPublishPlan['transitionArchives'] = [];
  for (const t of document.transitions) {
    const write: TransitionWrite = {
      id: t.id,
      name: t.name,
      fromStageId: t.fromStageId,
      toStageId: t.toStageId,
      display: t.display,
      intent: t.intent ?? 'action',
      sortOrder: t.sortOrder,
      form: t.form,
    };
    if (isNew(t.id) || !currentTransitionsById.has(t.id)) {
      transitionCreates.push(write);
      continue;
    }
    const existing = currentTransitionsById.get(t.id)!;
    const unchanged =
      existing.name === write.name &&
      existing.fromStageId === write.fromStageId &&
      existing.toStageId === write.toStageId &&
      existing.display === write.display &&
      (existing.intent ?? 'action') === write.intent &&
      existing.sortOrder === write.sortOrder &&
      sameRules(existing.rules, t.rules) &&
      sameForm(existing.form, write.form);
    if (!unchanged) transitionUpdates.push(write);
  }
  const docTransitionIds = new Set(document.transitions.map((t) => t.id));
  for (const t of current.transitions) {
    if (!docTransitionIds.has(t.id)) transitionArchives.push({ transitionId: t.id });
  }

  // Действия (#633): та же схема «создать / обновить / архивировать».
  const currentActionsById = new Map((current.actions ?? []).map((a) => [a.id, a]));
  const actionCreates: ActionWrite[] = [];
  const actionUpdates: ActionWrite[] = [];
  const actionArchives: WorkflowPublishPlan['actionArchives'] = [];
  for (const a of document.actions ?? []) {
    const write: ActionWrite = {
      id: a.id,
      name: a.name,
      stageId: a.stageId,
      display: a.display,
      sortOrder: a.sortOrder,
      rules: a.rules,
      form: a.form,
      steps: a.steps,
    };
    if (isNew(a.id) || !currentActionsById.has(a.id)) {
      actionCreates.push(write);
      continue;
    }
    const existing = currentActionsById.get(a.id)!;
    const unchanged =
      existing.name === write.name &&
      existing.stageId === write.stageId &&
      existing.display === write.display &&
      existing.sortOrder === write.sortOrder &&
      sameRules(existing.rules, a.rules) &&
      sameForm(existing.form, write.form) &&
      JSON.stringify(existing.steps) === JSON.stringify(write.steps);
    if (!unchanged) actionUpdates.push(write);
  }
  const docActionIds = new Set((document.actions ?? []).map((a) => a.id));
  // Секции нет — «действий не трогаем»: документ без раздела (старый кэш,
  // скрипт по API) не должен молча сносить живые кнопки маршрута.
  if (document.actions !== undefined) {
    for (const a of current.actions ?? []) {
      if (!docActionIds.has(a.id)) actionArchives.push({ actionId: a.id });
    }
  }

  // Переносы: только для архивируемых стадий (лишнее игнорируем).
  const archivedIds = new Set(stageArchives.map((a) => a.stageId));
  const moves = migrations
    .filter((m) => archivedIds.has(m.fromStageId))
    .map((m) => ({ fromStageId: m.fromStageId, toDocId: m.toStageId }));

  return {
    stageCreates,
    stageUpdates,
    stageArchives,
    transitionCreates,
    transitionUpdates,
    transitionArchives,
    actionCreates,
    actionUpdates,
    actionArchives,
    moves,
    restates,
  };
}

/** Канонический JSON (ключи по алфавиту) — сравнение правил без шума порядка. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Правила кнопки не менялись. Ссылка на новый статус (`new:*`) — заведомо
 *  изменение: прежние правила не могли ссылаться на несуществующий статус. */
function sameRules(existing: unknown, next: unknown): boolean {
  const nextJson = canonicalJson(next);
  return !nextJson.includes('"new:') && canonicalJson(existing) === nextJson;
}

/** Форма окна не менялась (канонический JSON — порядок ключей не шумит). */
function sameForm(existing: unknown, next: unknown): boolean {
  return canonicalJson(existing) === canonicalJson(next);
}

/** Обязательные переносы: архивируемые стадии с задачами без переноса. */
export function missingMigrations(plan: WorkflowPublishPlan): { stageId: string; count: number }[] {
  const moved = new Set(plan.moves.map((m) => m.fromStageId));
  return plan.stageArchives
    .filter((a) => a.taskCount > 0 && !moved.has(a.stageId))
    .map((a) => ({ stageId: a.stageId, count: a.taskCount }));
}

/** Резолв docId стадии документа → uuid после создания новых (uuid для uuid). */
export function resolveDocId(docId: string, createdIds: Map<string, string>): string | undefined {
  if (docId.startsWith('new:')) return createdIds.get(docId);
  return docId;
}

/** Правила перехода к публикации: цели route_if `new:*` резолвятся в
 *  созданные uuid — иначе опубликованная схема ≠ исполняемая (security
 *  #378, целостность: пост-функция молча не находила цель). */
export function resolveRules<T extends { postFunctions: readonly unknown[] }>(
  rules: T,
  createdIds: Map<string, string>,
): T {
  const posts = rules.postFunctions as readonly { kind?: string; toStageId?: string }[];
  const needsResolve = posts.some(
    (pf) =>
      pf.kind === 'route_if' && typeof pf.toStageId === 'string' && pf.toStageId.startsWith('new:'),
  );
  if (!needsResolve) return rules;
  return {
    ...rules,
    postFunctions: (posts as readonly Record<string, unknown>[]).map((pf) =>
      pf.kind === 'route_if' && typeof pf.toStageId === 'string'
        ? { ...pf, toStageId: resolveDocId(pf.toStageId, createdIds) ?? pf.toStageId }
        : pf,
    ),
  } as T;
}
