import type { WorkflowDocument } from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type { FieldBindingTargetReader } from '../../../projects/ports/field-binding-targets.port.js';
import { ProcessTypesRepository } from '../../types/process-types.repository.js';
import { WorkflowRepository } from '../workflow.repository.js';

/**
 * Серверные факты общей выборки (#635) для проверки публикации: предикаты
 * type_is/stage_is/folderTypeId ссылаются на живые типы, стадии их маршрутов
 * и виды папок — мёртвая ссылка ловится здесь, а не в рантайме кнопки.
 * Читается один раз на публикацию; без правил выборки в документе не
 * вызывается вовсе.
 */
export async function conditionFactsOf(
  deps: {
    types: ProcessTypesRepository;
    workflows: WorkflowRepository;
    nodeKinds: FieldBindingTargetReader;
  },
  document: WorkflowDocument,
  tx?: TransactionClient,
): Promise<ConditionFacts> {
  const liveTypes = await deps.types.list('exclude');
  const conditionTypeFacts = new Set(liveTypes.map((type) => type.id));

  // Стадии маршрутов типов из предикатов type_is: stage_is обязан указывать
  // на живой статус активного маршрута этого типа.
  const typeIds = [...new Set(typeIsIdsOf(document))];
  const conditionStageFacts = new Map<string, Set<string>>();
  for (const typeId of typeIds) {
    const workflowId = await deps.types.workflowIdOf(typeId);
    const stages = workflowId ? await deps.workflows.findStages(workflowId, tx) : [];
    conditionStageFacts.set(typeId, new Set(stages.map((stage) => stage.id)));
  }

  // Живые виды папок: архивный вид в выборке — ошибка (новые папки такого
  // типа не появляются, настройка мертвеет).
  const kinds = await deps.nodeKinds.nodeKinds();
  const conditionNodeKindFacts = new Set(
    kinds.filter((kind) => !kind.archived).map((kind) => kind.id),
  );

  return { conditionTypeFacts, conditionStageFacts, conditionNodeKindFacts };
}

export interface ConditionFacts {
  conditionTypeFacts: ReadonlySet<string>;
  conditionStageFacts: ReadonlyMap<string, ReadonlySet<string>>;
  conditionNodeKindFacts: ReadonlySet<string>;
}

/** typeId из предикатов type_is всех выборок документа. */
function typeIsIdsOf(document: WorkflowDocument): string[] {
  const ids: string[] = [];
  const owners = [
    ...document.transitions.map((t) => t.rules),
    ...(document.actions ?? []).map((a) => a.rules),
  ];
  for (const rules of owners) {
    const queries = [
      ...rules.conditions.filter((c) => c.kind === 'records').map((c) => c.query),
      ...rules.validators.filter((v) => v.kind === 'records').map((v) => v.query),
    ];
    for (const query of queries) {
      for (const predicate of query.where) {
        if (predicate.kind === 'type_is') ids.push(predicate.typeId);
      }
    }
  }
  return ids;
}
