import { vi, type Mock } from 'vitest';

import { CatalogBootstrap } from './catalog.bootstrap.js';
import { CATALOG_PROCESS_TYPES } from './system-catalog.js';

/** Мок-стенд бутстрапа каталога (#55): общий для тестов задач и писем —
 *  детерминированные id маршрутов/стадий и семантика «засев один раз». */
type StageOverride = Partial<{
  systemState: string;
  sortOrder: number;
  name: string;
  outcome: string | null;
}>;

interface DbState {
  /** код маршрута → { customizedAt, catalogRevision }. */
  workflows: Record<string, { customizedAt: Date | null; catalogRevision: number }>;
  /** typeId → customizedAt. */
  typeCustomized: Record<string, Date | null>;
  stageOverrides: Record<string, StageOverride>;
  /** Живые переходы вне каталога (ревизия 1: complete_new, postpone_new). */
  legacyTransitions: { id: string; code: string }[];
  /** Маршруты без стадий в БД (новая установка): id workflow. */
  emptyWorkflows: string[];
}

export const STANDARD = CATALOG_PROCESS_TYPES[0]!.workflow;
export const QUICK = CATALOG_PROCESS_TYPES[1]!.workflow;
/** Каталог целиком (задачи + письма #55): id маршрутов детерминированные. */
const WORKFLOW_ENTRIES = CATALOG_PROCESS_TYPES.map((entry, index) => ({
  id: `wf-${index}`,
  def: entry.workflow,
}));
const WORKFLOW_BY_ID = new Map(WORKFLOW_ENTRIES.map((entry) => [entry.id, entry]));
const WORKFLOW_BY_CODE = new Map(WORKFLOW_ENTRIES.map((entry) => [entry.def.code, entry]));
export const wfId = (code: string): string => WORKFLOW_BY_CODE.get(code)!.id;
const revisionOf = (code: string): number => WORKFLOW_BY_CODE.get(code)!.def.revision;

/** id стадий — детерминированные uuid (цели route_if валидируются zod). */
export const uuidFor = (code: string): string => {
  const codes = WORKFLOW_ENTRIES.flatMap((entry) => entry.def.stages.map((s) => s.code));
  const index = codes.indexOf(code);
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
};

/** Мок БД: по умолчанию текущая ревизия применена везде; validate семантики
 *  «засев один раз». */
export interface CatalogBootstrapRepo {
  ensureType: Mock;
  ensureSeries: Mock;
  ensureDefaultScheme: Mock;
  ensureSchemeEntry: Mock;
  lockWorkflow: Mock;
  seedState: Mock;
  isTypeCustomized: Mock;
  applyTypeRevision: Mock;
  applyWorkflowRevision: Mock;
  ensureWorkflow: Mock;
  findStage: Mock;
  createStage: Mock;
  updateStage: Mock;
  liveTransitions: Mock;
  archiveTransition: Mock;
  findTransition: Mock;
  updateTransition: Mock;
  createTransition: Mock;
}

export interface CatalogBootstrapStand {
  bootstrap: CatalogBootstrap;
  repo: CatalogBootstrapRepo;
  eventBus: { emit: Mock };
  logger: { setContext: Mock; info: Mock; warn: Mock };
  tx: unknown;
}

export function setup(state: Partial<DbState> = {}): CatalogBootstrapStand {
  const workflows: DbState['workflows'] = {
    ...Object.fromEntries(
      WORKFLOW_ENTRIES.map((entry) => [
        entry.def.code,
        { customizedAt: null, catalogRevision: entry.def.revision },
      ]),
    ),
    ...(state.workflows ?? {}),
  };
  const typeCustomized = state.typeCustomized ?? {};
  const stageRow = (workflowId: string, code: string) => {
    const def = WORKFLOW_BY_ID.get(workflowId)!.def;
    const index = def.stages.findIndex((s) => s.code === code);
    const s = def.stages[index]!;
    return {
      id: uuidFor(code),
      name: s.name,
      color: s.color,
      sortOrder: index,
      systemState: s.systemState,
      outcome: s.outcome ?? null,
      isInitial: s.isInitial ?? false,
      ...((state.stageOverrides ?? {})[code] ?? {}),
    };
  };
  const created: string[] = [];
  const repo = {
    ensureType: vi
      .fn()
      .mockImplementation((_tx: unknown, def: { code: string }) =>
        Promise.resolve({ id: `type-${def.code}` }),
      ),
    ensureSeries: vi
      .fn()
      .mockImplementation((_tx: unknown, def: { code: string }) =>
        Promise.resolve({ id: `series-${def.code}` }),
      ),
    ensureDefaultScheme: vi.fn().mockResolvedValue({ id: 'scheme' }),
    ensureSchemeEntry: vi.fn(),
    lockWorkflow: vi.fn(),
    seedState: vi
      .fn()
      .mockImplementation((_tx: unknown, id: string) =>
        Promise.resolve(workflows[WORKFLOW_BY_ID.get(id)!.def.code]!),
      ),
    isTypeCustomized: vi
      .fn()
      .mockImplementation((_tx: unknown, id: string) =>
        Promise.resolve((typeCustomized[id] ?? null) !== null),
      ),
    applyTypeRevision: vi.fn(),
    applyWorkflowRevision: vi.fn().mockResolvedValue(5),
    ensureWorkflow: vi
      .fn()
      .mockImplementation((_tx: unknown, def: { code: string }) =>
        Promise.resolve({ id: wfId(def.code) }),
      ),
    findStage: vi
      .fn()
      .mockImplementation((_tx: unknown, wf: string, code: string) =>
        Promise.resolve((state.emptyWorkflows ?? []).includes(wf) ? null : stageRow(wf, code)),
      ),
    createStage: vi.fn().mockImplementation((_tx: unknown, wf: string) => {
      created.push(wf);
      return Promise.resolve({ id: `created-${created.length}` });
    }),
    updateStage: vi.fn(),
    liveTransitions: vi
      .fn()
      .mockImplementation((_tx: unknown, wf: string) =>
        Promise.resolve(wf === wfId(STANDARD.code) ? (state.legacyTransitions ?? []) : []),
      ),
    archiveTransition: vi.fn(),
    findTransition: vi
      .fn()
      .mockImplementation((_tx: unknown, wf: string) =>
        Promise.resolve((state.emptyWorkflows ?? []).includes(wf) ? null : { id: 'tr' }),
      ),
    updateTransition: vi.fn(),
    createTransition: vi.fn(),
  };
  const eventBus = { emit: vi.fn() };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const TX = { tx: true };
  const bootstrap = new CatalogBootstrap(
    { run: (fn: (tx: unknown) => unknown) => fn(TX) } as never,
    repo as never,
    eventBus as never,
    logger as never,
    { kindIdByName: vi.fn(async () => null) } as never,
  );
  return { bootstrap, repo, eventBus, logger, tx: TX };
}

export const stale = (code: string) => ({
  [code]: { customizedAt: null, catalogRevision: revisionOf(code) - 1 },
});
