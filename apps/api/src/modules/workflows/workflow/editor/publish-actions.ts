import type { Prisma } from '../../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type { WorkflowDocument } from '@nodus/contracts';

import { resolveRules, type WorkflowPublishPlan } from './publish-planner.js';
import type { WorkflowPublishRepository } from './publish.repository.js';

const NO_RULES = { conditions: [], validators: [], postFunctions: [] };
/** Форма по умолчанию у окна действия — как у перехода (#380). */
const DEFAULT_ACTION_FORM = { enabled: false, sections: [] };

/**
 * Применение плана действий (#633) — вынесено из publish.service ради
 * лимита размера файла (I5). Действие хранится построчно, как переход:
 * стадия — docId (может быть новой стадией документа), «любой статус» — null.
 */
export async function applyActionPlan(args: {
  writes: WorkflowPublishRepository;
  tx: TransactionClient;
  workflowId: string;
  document: WorkflowDocument;
  plan: WorkflowPublishPlan;
  /** docId стадии → uuid (в т.ч. созданных этой публикацией). */
  stages: Map<string, string>;
  now: Date;
}): Promise<void> {
  const { writes, tx, workflowId, document, plan, stages, now } = args;
  const actions = document.actions ?? [];
  const stageOf = (docId: string | null): string | null =>
    docId === null ? null : (stages.get(docId) ?? docId);

  const rowOf = (write: WorkflowPublishPlan['actionCreates'][number]) => {
    const source = actions.find((a) => a.id === write.id);
    return {
      name: write.name,
      stageId: stageOf(write.stageId),
      display: write.display,
      sortOrder: write.sortOrder,
      rules: resolveRules(source?.rules ?? NO_RULES, stages) as Prisma.InputJsonValue,
      form: (source?.form ?? DEFAULT_ACTION_FORM) as Prisma.InputJsonValue,
      steps: (source?.steps ?? []) as Prisma.InputJsonValue,
    };
  };

  for (const write of plan.actionCreates) {
    await writes.createAction(tx, workflowId, rowOf(write));
  }
  for (const write of plan.actionUpdates) {
    await writes.updateAction(tx, write.id, rowOf(write));
  }
  for (const { actionId } of plan.actionArchives) {
    await writes.archiveAction(tx, actionId, now);
  }
}
