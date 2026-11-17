import { hotTools } from '../tools/catalog.js';
import { RETRIEVAL_VERSION, simulateRouter, understandQuery } from '../tools/retrieval.js';
import { searchTools } from '../tools/search.js';
import type { AssistantToolDefinition } from '../tools/tool-definition.js';
import type { GoldenCase, GoldenRole } from './golden-set.types.js';

/**
 * Детерминированный прогон золотого набора (#926): для каждого запроса
 * считаются две траектории выбора — лексический `tools.search` (top-7) и
 * симулятор диспетчера (тот же скорер + порог). Модель и сеть не нужны:
 * baseline воспроизводим, гейт гоняется в CI.
 *
 * Метрики: recall@7, «все ожидаемые в top-7», доля неверных инструментов,
 * корректный отказ на отсутствующий инструмент, безопасность уточнений.
 */

export type EvalPath = 'search' | 'router';

export interface CaseOutcome {
  testCase: GoldenCase;
  split: 'dev' | 'holdout';
  searchTop: string[];
  routerTop: string[];
  recall: Record<EvalPath, number>;
  allExpected: Record<EvalPath, boolean>;
  forbiddenHits: Record<EvalPath, string[]>;
  /** Запрещённый инструмент выбран первым — это уже неверное решение. */
  forbiddenTop1: Record<EvalPath, string[]>;
  refusalOk: Record<EvalPath, boolean | null>;
  clarifyOk: Record<EvalPath, boolean | null>;
}

export interface PathMetrics {
  /** Микро-recall@7 по ожидаемым инструментам поддерживаемых кейсов. */
  recallAt7: number;
  /** Доля кейсов, где ВСЕ ожидаемые инструменты попали в top-7. */
  allExpectedAt7: number;
  /** Доля кейсов, где запрещённый инструмент ВЫБРАН ПЕРВЫМ (< 5%). */
  wrongToolRate: number;
  /** Доля кейсов, где запрещённый инструмент просто попал в полку top-7
   *  (справочно: полка — кандидаты, решение принимает модель). */
  forbiddenShelfRate: number;
  /** Доля корректных отказов среди noTool-кейсов. */
  refusalAccuracy: number;
  /** Доля безопасных уточнений: в выборе нет запрещённого/записи. */
  clarifySafety: number;
  /** Доля кейсов, где первый инструмент — ожидаемый. */
  top1Accuracy: number;
}

export interface ShelfAnalysis {
  hotSize: number;
  /** Доля ожидаемых инструментов, доступных на горячей полке. */
  hotRecall: number;
  /** Доля поддерживаемых кейсов, полностью покрытых горячей полкой. */
  hotCaseCoverage: number;
  frequency: { id: string; count: number; hot: boolean }[];
  /** Предложение полки 12–15 по частоте золотого набора. */
  suggestedHot: string[];
  missingFromCurrentHot: string[];
  extraInCurrentHot: string[];
}

export interface EvalResult {
  retrievalVersion: string;
  catalogSize: number;
  caseCount: number;
  supportedCount: number;
  noToolCount: number;
  clarifyCount: number;
  search: PathMetrics;
  router: PathMetrics;
  byRole: Record<GoldenRole, { cases: number; search: PathMetrics; router: PathMetrics }>;
  bySplit: Record<'dev' | 'holdout', { cases: number; search: PathMetrics; router: PathMetrics }>;
  outcomes: CaseOutcome[];
  shelf: ShelfAnalysis;
  /** Покрытие каталога золотым набором (кроме служебных system). */
  catalogCoverage: { expected: number; total: number; unmentioned: string[] };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/** Детерминированное разбиение на dev/holdout (25%) — без утечки в правки. */
function splitOf(id: string): 'dev' | 'holdout' {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return hash % 4 === 0 ? 'holdout' : 'dev';
}

function isWriteQuery(caseItem: GoldenCase): boolean {
  const query = understandQuery(caseItem.query);
  return [...query.intents].some((intent) =>
    ['create', 'update', 'delete', 'transition', 'send', 'remember', 'forget'].includes(intent),
  );
}

function outcomeOf(testCase: GoldenCase, catalog: readonly AssistantToolDefinition[]): CaseOutcome {
  const searchTop = searchTools(catalog, testCase.query, 7);
  const routerTop = simulateRouter(catalog, testCase.query, 7);
  const top = { search: searchTop, router: routerTop } as const;
  const expected = new Set(testCase.expectedTools);
  const forbidden = new Set(testCase.forbiddenTools);
  const writeQuery = isWriteQuery(testCase);

  const recall = {} as Record<EvalPath, number>;
  const allExpected = {} as Record<EvalPath, boolean>;
  const forbiddenHits = {} as Record<EvalPath, string[]>;
  const forbiddenTop1 = {} as Record<EvalPath, string[]>;
  const refusalOk = {} as Record<EvalPath, boolean | null>;
  const clarifyOk = {} as Record<EvalPath, boolean | null>;

  for (const path of ['search', 'router'] as const) {
    const ids = top[path].map((tool) => tool.id);
    const hits = ids.filter((id) => expected.has(id)).length;
    recall[path] = ratio(hits, expected.size);
    allExpected[path] = expected.size > 0 && hits === expected.size;
    forbiddenHits[path] = ids.filter((id) => forbidden.has(id));
    forbiddenTop1[path] = ids.length > 0 && forbidden.has(ids[0]!) ? [ids[0]!] : [];
    if (testCase.noToolCase) {
      const writeChosen = top[path][0]?.kind === 'write';
      refusalOk[path] = forbiddenTop1[path].length === 0 && !(writeQuery && writeChosen);
    } else {
      refusalOk[path] = null;
    }
    // Уточнение безопасно, если не выбран запрещённый инструмент: правильный
    // инструмент может быть в наборе — модель всё равно спросит имя/id.
    clarifyOk[path] = testCase.shouldClarify ? forbiddenTop1[path].length === 0 : null;
  }

  return {
    testCase,
    split: splitOf(testCase.id),
    searchTop: searchTop.map((tool) => tool.id),
    routerTop: routerTop.map((tool) => tool.id),
    recall,
    allExpected,
    forbiddenHits,
    forbiddenTop1,
    refusalOk,
    clarifyOk,
  };
}

function topOf(outcome: CaseOutcome, path: EvalPath): readonly string[] {
  return path === 'search' ? outcome.searchTop : outcome.routerTop;
}

function metricsFor(outcomes: readonly CaseOutcome[], path: EvalPath): PathMetrics {
  const supported = outcomes.filter((outcome) => outcome.testCase.expectedTools.length > 0);
  const expectedTotal = supported.reduce(
    (sum, outcome) => sum + outcome.testCase.expectedTools.length,
    0,
  );
  const expectedHit = supported.reduce(
    (sum, outcome) =>
      sum + outcome.testCase.expectedTools.filter((id) => topOf(outcome, path).includes(id)).length,
    0,
  );
  const noTool = outcomes.filter((outcome) => outcome.testCase.noToolCase);
  const clarify = outcomes.filter((outcome) => outcome.testCase.shouldClarify);
  return {
    recallAt7: ratio(expectedHit, expectedTotal),
    allExpectedAt7: ratio(
      supported.filter((outcome) => outcome.allExpected[path]).length,
      supported.length,
    ),
    wrongToolRate: ratio(
      supported.filter((outcome) => outcome.forbiddenTop1[path].length > 0).length,
      supported.length,
    ),
    forbiddenShelfRate: ratio(
      supported.filter((outcome) => outcome.forbiddenHits[path].length > 0).length,
      supported.length,
    ),
    refusalAccuracy: ratio(
      noTool.filter((outcome) => outcome.refusalOk[path]).length,
      noTool.length,
    ),
    clarifySafety: ratio(
      clarify.filter((outcome) => outcome.clarifyOk[path]).length,
      clarify.length,
    ),
    top1Accuracy: ratio(
      supported.filter((outcome) =>
        outcome.testCase.expectedTools.includes(topOf(outcome, path)[0] ?? ''),
      ).length,
      supported.length,
    ),
  };
}

function shelfOf(
  catalog: readonly AssistantToolDefinition[],
  outcomes: readonly CaseOutcome[],
): ShelfAnalysis {
  const hot = hotTools(catalog);
  const hotIds = new Set(hot.map((tool) => tool.id));
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    for (const id of outcome.testCase.expectedTools) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const frequency = [...counts.entries()]
    .map(([id, count]) => ({ id, count, hot: hotIds.has(id) }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const suggestedHot = frequency.slice(0, 15).map((entry) => entry.id);
  const suggestedSet = new Set(suggestedHot);
  const supported = outcomes.filter((outcome) => outcome.testCase.expectedTools.length > 0);
  const expectedTotal = supported.reduce(
    (sum, outcome) => sum + outcome.testCase.expectedTools.length,
    0,
  );
  const hotExpected = supported.reduce(
    (sum, outcome) => sum + outcome.testCase.expectedTools.filter((id) => hotIds.has(id)).length,
    0,
  );
  return {
    hotSize: hot.length,
    hotRecall: ratio(hotExpected, expectedTotal),
    hotCaseCoverage: ratio(
      supported.filter((outcome) => outcome.testCase.expectedTools.every((id) => hotIds.has(id)))
        .length,
      supported.length,
    ),
    frequency,
    suggestedHot,
    missingFromCurrentHot: suggestedHot.filter((id) => !hotIds.has(id)),
    extraInCurrentHot: hot.map((tool) => tool.id).filter((id) => !suggestedSet.has(id)),
  };
}

export function runEval(
  catalog: readonly AssistantToolDefinition[],
  cases: readonly GoldenCase[],
): EvalResult {
  const outcomes = cases.map((testCase) => outcomeOf(testCase, catalog));
  const roles: GoldenRole[] = ['gip', 'secretary', 'admin', 'employee'];
  const byRole = {} as EvalResult['byRole'];
  for (const role of roles) {
    const subset = outcomes.filter((outcome) => outcome.testCase.role === role);
    byRole[role] = {
      cases: subset.length,
      search: metricsFor(subset, 'search'),
      router: metricsFor(subset, 'router'),
    };
  }
  const bySplit = {} as EvalResult['bySplit'];
  for (const split of ['dev', 'holdout'] as const) {
    const subset = outcomes.filter((outcome) => outcome.split === split);
    bySplit[split] = {
      cases: subset.length,
      search: metricsFor(subset, 'search'),
      router: metricsFor(subset, 'router'),
    };
  }
  const expectedIds = new Set(cases.flatMap((testCase) => testCase.expectedTools));
  const shelf = shelfOf(catalog, outcomes);
  return {
    retrievalVersion: RETRIEVAL_VERSION,
    catalogSize: catalog.length,
    caseCount: cases.length,
    supportedCount: outcomes.filter((outcome) => outcome.testCase.expectedTools.length > 0).length,
    noToolCount: outcomes.filter((outcome) => outcome.testCase.noToolCase).length,
    clarifyCount: outcomes.filter((outcome) => outcome.testCase.shouldClarify).length,
    search: metricsFor(outcomes, 'search'),
    router: metricsFor(outcomes, 'router'),
    byRole,
    bySplit,
    outcomes,
    shelf,
    catalogCoverage: {
      expected: expectedIds.size,
      total: catalog.length,
      unmentioned: catalog.filter((tool) => !expectedIds.has(tool.id)).map((tool) => tool.id),
    },
  };
}
