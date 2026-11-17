import { ErrorCode, type WorkflowDocument } from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import { DomainException } from '../../../../core/errors/domain-exception.js';
import type { WorkflowPressRoundsReader } from '../../ports/workflow-press-rounds.port.js';
import type { LoadedWorkflow } from '../workflow.repository.js';
import type { WorkflowPublishPlan } from './publish-planner.js';

/**
 * Защита публикации при открытых раундах сбора (#434, В4). Снимок раунда
 * покрывает настройку, окно и источники, поэтому название, порядок, показ и
 * окно менять можно. Блокируются только цель перехода и правила (гейты):
 * движок при кворуме выполнил бы уже другой переход. Архив кнопки — всегда.
 * Отказ называет задачи, которые держат кнопку.
 */
export async function assertPressPublishAllowed(
  pressRounds: WorkflowPressRoundsReader,
  workflowId: string,
  loaded: LoadedWorkflow,
  document: WorkflowDocument,
  plan: WorkflowPublishPlan,
  tx: TransactionClient,
): Promise<void> {
  const openPress = await pressRounds.openTransitionIds(workflowId, tx);
  const archived = plan.transitionArchives
    .map((archive) => archive.transitionId)
    .filter((transitionId) => openPress.has(transitionId));
  const changedRules = plan.transitionUpdates
    .filter((update) => openPress.has(update.id))
    .filter((update) => {
      const live = loaded.transitions.find((transition) => transition.id === update.id);
      if (!live) return true;
      const draft = document.transitions.find((transition) => transition.id === update.id);
      return (
        update.fromStageId !== live.fromStageId ||
        update.toStageId !== live.toStageId ||
        JSON.stringify(draft?.rules ?? null) !== JSON.stringify(live.rules ?? null)
      );
    })
    .map((update) => update.id);
  const touched = [...new Set([...archived, ...changedRules])];
  if (touched.length === 0) return;
  const holders = (await pressRounds.openTasks(workflowId, tx)).filter((task) =>
    touched.includes(task.transitionId),
  );
  throw new DomainException(ErrorCode.CONFLICT, 'Press rounds are open for changed buttons', {
    transitionIds: touched,
    tasks: holders,
  });
}
