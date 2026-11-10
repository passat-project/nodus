import { DEFAULT_TRANSITION_FORM, type WorkflowDocument } from '@nodus/contracts';

import type { Prisma } from '../../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import { resolveDocId, resolveRules, type WorkflowPublishPlan } from './publish-planner.js';
import type { WorkflowPublishRepository } from './publish.repository.js';

const NO_RULES = { conditions: [], validators: [], postFunctions: [] };

/**
 * Применение плана публикации (ADR-0021): создание (new:* → uuid), правки,
 * архив вместо удаления. Вынесено из WorkflowEditorService (I5): сервис
 * держит транзакцию и проверки, здесь — только запись плана.
 */
export async function applyPublishPlan(
  writes: WorkflowPublishRepository,
  tx: TransactionClient,
  workflowId: string,
  document: WorkflowDocument,
  plan: WorkflowPublishPlan,
  now: Date,
) {
  const stages = new Map<string, string>();
  const transitions = new Map<string, string>();
  for (const { docId, ...stage } of plan.stageCreates) {
    stages.set(docId, await writes.createStage(tx, workflowId, stage));
  }
  for (const update of plan.stageUpdates) await writes.updateStage(tx, update);

  const resolve = (docId: string): string | undefined => resolveDocId(docId, stages);
  const rowOf = (write: WorkflowPublishPlan['transitionCreates'][number]) => ({
    name: write.name,
    fromStageId: write.fromStageId === null ? null : (resolve(write.fromStageId) ?? null),
    toStageId: resolve(write.toStageId)!,
    display: write.display,
    intent: write.intent,
    sortOrder: write.sortOrder,
    rules: resolveRules(
      document.transitions.find((t) => t.id === write.id)?.rules ?? NO_RULES,
      stages,
    ) as Prisma.InputJsonValue,
    form: (document.transitions.find((t) => t.id === write.id)?.form ??
      DEFAULT_TRANSITION_FORM) as Prisma.InputJsonValue,
    press: (document.transitions.find((t) => t.id === write.id)?.press ??
      null) as Prisma.InputJsonValue | null,
  });
  for (const write of plan.transitionCreates) {
    transitions.set(write.id, await writes.createTransition(tx, workflowId, rowOf(write)));
  }
  for (const write of plan.transitionUpdates) {
    await writes.updateTransition(tx, write.id, rowOf(write));
  }
  for (const { transitionId } of plan.transitionArchives) {
    await writes.archiveTransition(tx, transitionId, now);
  }
  for (const { stageId } of plan.stageArchives) await writes.archiveStage(tx, stageId, now);
  return { stages, transitions, resolve };
}
