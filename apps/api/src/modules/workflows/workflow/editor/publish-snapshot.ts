import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type { WorkflowEntityRegistry } from '../engine/entity-adapter.registry.js';
import type { LoadedWorkflow } from '../workflow.repository.js';
import type { PlannerSnapshot } from './publish-planner.js';
import type { WorkflowRepository } from '../workflow.repository.js';

/**
 * Снимок живого маршрута для планировщика публикации (#433 — вынесен из
 * сервиса, чтобы файл держал лимит I5). Правила кнопок идут как есть;
 * счётчики задач — через адаптер категории (read-порт сущности).
 */
export async function publishSnapshot(
  tx: TransactionClient,
  loaded: LoadedWorkflow,
  category: Awaited<ReturnType<WorkflowRepository['categoryOf']>>,
  adapters: WorkflowEntityRegistry,
): Promise<PlannerSnapshot> {
  return {
    stages: loaded.stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      systemState: s.systemState,
      outcome: s.outcome,
      isInitial: s.isInitial,
      sortOrder: s.sortOrder,
    })),
    transitions: loaded.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      fromStageId: t.fromStageId,
      toStageId: t.toStageId,
      display: t.display,
      intent: t.intent,
      sortOrder: t.sortOrder,
      rules: t.rules,
      form: t.form,
    })),
    actions: (loaded.actions ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      stageId: a.stageId,
      display: a.display,
      sortOrder: a.sortOrder,
      rules: a.rules,
      form: a.form,
      steps: a.steps,
    })),
    taskCounts: await adapters.get(category).countByStages(
      loaded.stages.map((s) => s.id),
      tx,
    ),
  };
}
