import type { WorkflowDraftDocument, WorkflowDraftTransition } from '@nodus/contracts';

/** Инварианты документа рабочей копии (#378): sortOrder = индекс в колонке
 *  этапа (нормализация после каждой структурной правки — раскладка и
 *  публикация читают одно и то же), история — снимки ≤100, id новых
 *  элементов `new:<uuid>`. */

export const HISTORY_LIMIT = 100;

export function newId(): string {
  return `new:${crypto.randomUUID()}`;
}

/** sortOrder этапов = индекс в группе (systemState). После каждой
 *  структурной правки клиент перенумеровывает ТОЛЬКО группы, а сервер
 *  отдаёт глобальную нумерацию — поэтому при загрузке baseline и документ
 *  прогоняются одной канонизацией (canonicalDocument), иначе сравнение
 *  structureChanged видит разницу там, где на экране ничего не изменилось
 *  (#409: ложное «есть изменения» сразу при входе). */
function normalizeStages(stages: WorkflowDraftDocument['stages']) {
  const counters = new Map<string, number>();
  return stages.map((stage) => {
    const next = counters.get(stage.systemState) ?? 0;
    counters.set(stage.systemState, next + 1);
    return { ...stage, sortOrder: next };
  });
}

/** sortOrder кнопок = индекс внутри группы «из какого статуса» (fromStageId,
 *  null — «из любого»). Порядок берётся по текущему sortOrder (array order
 *  после moveTransition НЕ совпадает с порядком кнопок — перестановка
 *  меняет только sortOrder), поэтому сортируем стабильно по значению. */
function normalizeTransitions(transitions: WorkflowDraftTransition[]): WorkflowDraftTransition[] {
  const groups = new Map<string, WorkflowDraftTransition[]>();
  for (const transition of transitions) {
    const key = transition.fromStageId ?? 'any';
    const group = groups.get(key);
    if (group) group.push(transition);
    else groups.set(key, [transition]);
  }
  const order = new Map<string, number>();
  for (const group of groups.values()) {
    [...group]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((transition, index) => order.set(transition.id, index));
  }
  return transitions.map((transition) => ({
    ...transition,
    sortOrder: order.get(transition.id) ?? transition.sortOrder,
  }));
}

/** Канонизация ПРИ ЗАГРУЗКЕ (сервер/черновик): та же нумерация, что даёт
 *  клиент после правок. Только для loadedState — обычный normalize() ниже
 *  намеренно не трогает кнопки (moveTransition хранит порядок в sortOrder). */
export function canonicalDocument(doc: WorkflowDraftDocument): WorkflowDraftDocument {
  return {
    ...doc,
    stages: normalizeStages(doc.stages),
    transitions: normalizeTransitions(doc.transitions),
  };
}

export function normalize(doc: WorkflowDraftDocument): WorkflowDraftDocument {
  return { ...doc, stages: normalizeStages(doc.stages) };
}

/** Сменилась ли СТРУКТУРА маршрута (статусы, кнопки и форма создания)
 *  против опубликованной. Расстановка холста — оформление: она сохраняется
 *  сама, без публикации, и черновиком маршрута не считается. Форма создания
 *  входит в канонизацию и сравнение (урок #409): иначе «Сбросить» не
 *  возвращал бы форму, а вход показывал ложное «есть изменения». */
export function structureChanged(
  document: WorkflowDraftDocument,
  baseline: WorkflowDraftDocument,
): boolean {
  return (
    JSON.stringify([
      document.stages,
      document.transitions,
      document.actions ?? [],
      document.creation ?? null,
    ]) !==
    JSON.stringify([
      baseline.stages,
      baseline.transitions,
      baseline.actions ?? [],
      baseline.creation ?? null,
    ])
  );
}

export interface HistoryTail {
  document: WorkflowDraftDocument;
  past: WorkflowDraftDocument[];
  future: WorkflowDraftDocument[];
  dirty: boolean;
}

export function withHistory(
  state: {
    document: WorkflowDraftDocument;
    baseline: WorkflowDraftDocument;
    past: WorkflowDraftDocument[];
    future: WorkflowDraftDocument[];
  },
  next: WorkflowDraftDocument,
): HistoryTail {
  return {
    document: next,
    past: [...state.past, state.document].slice(-HISTORY_LIMIT),
    future: [],
    dirty: structureChanged(next, state.baseline),
  };
}

/** Шаг истории: новый документ, границы past/future, dirty — структура
 *  против baseline. */
export function stepHistory(
  state: { document: WorkflowDraftDocument; baseline: WorkflowDraftDocument; dirty: boolean },
  document: WorkflowDraftDocument,
  past: WorkflowDraftDocument[],
  future: WorkflowDraftDocument[],
): {
  document: WorkflowDraftDocument;
  past: WorkflowDraftDocument[];
  future: WorkflowDraftDocument[];
  dirty: boolean;
} {
  return {
    document,
    past: past.slice(-HISTORY_LIMIT),
    future: future.slice(0, HISTORY_LIMIT),
    dirty: structureChanged(document, state.baseline),
  };
}
