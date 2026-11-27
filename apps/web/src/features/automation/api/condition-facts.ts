import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { hasConditionRules } from '@nodus/contracts';
import type { ConditionPredicate, WorkflowDraftDocument } from '@nodus/contracts';

import { useNodeKinds } from '../../../shared/api/node-kinds.js';
import { workflowDetailOptions } from '../../../shared/workflow/workflow-api.js';
import { useProcessTypes } from './automation-api.js';

/**
 * Живые факты общей выборки (#635) для проверок документа в редакторе:
 * типы, стадии их активных маршрутов, виды папок. Те же факты собирает
 * сервер на публикации (condition-facts.ts в API) — редактор и публикация
 * ругаются одинаково. Грузятся только когда в документе есть правила
 * выборки (`hasConditionRules`), иначе пусто.
 */
export function useConditionFacts(document: WorkflowDraftDocument): {
  conditionTypeFacts?: ReadonlySet<string>;
  conditionStageFacts?: ReadonlyMap<string, ReadonlySet<string>>;
  conditionNodeKindFacts?: ReadonlySet<string>;
} {
  const needed = hasConditionRules(document);
  // Оба списка по умолчанию — только живые (архив фильтрует сервер).
  const typesQuery = useProcessTypes();
  const nodeKindsQuery = useNodeKinds();

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const workflowByType = useMemo(
    () => new Map(types.map((type) => [type.id, type.workflowId])),
    [types],
  );
  // type_is этой выборки → стадии маршрутов этих типов (для stage_is).
  const typeIsIds = useMemo(() => {
    if (!needed) return [];
    const owners = [
      ...document.transitions.map((t) => t.rules),
      ...(document.actions ?? []).map((a) => a.rules),
    ];
    const ids = new Set<string>();
    for (const rules of owners) {
      for (const rule of rules.validators) {
        if (rule.kind === 'records') collectTypeIs(rule.query.where, ids);
      }
      for (const rule of rules.conditions) {
        if (rule.kind === 'records') collectTypeIs(rule.query.where, ids);
      }
    }
    return [...ids];
  }, [needed, document]);

  const stageQueries = useQueries({
    queries: typeIsIds.map((typeId) => workflowDetailOptions(workflowByType.get(typeId) ?? '')),
  });

  return useMemo(() => {
    if (!needed) return {};
    const conditionStageFacts = new Map<string, ReadonlySet<string>>();
    let stagesReady = typeIsIds.length > 0;
    typeIsIds.forEach((typeId, index) => {
      const detail = stageQueries[index]?.data;
      if (detail) {
        conditionStageFacts.set(typeId, new Set(detail.document.stages.map((stage) => stage.id)));
      } else {
        stagesReady = false;
      }
    });
    const nodeKinds = nodeKindsQuery.data;
    return {
      conditionTypeFacts: typesQuery.data ? new Set(types.map((type) => type.id)) : undefined,
      conditionNodeKindFacts: nodeKinds
        ? new Set(nodeKinds.filter((kind) => kind.archivedAt === null).map((kind) => kind.id))
        : undefined,
      // Стадии — только полным набором: неполный факт молча пропустил бы
      // мёртвую ссылку stage_is.
      ...(typeIsIds.length === 0 || stagesReady ? { conditionStageFacts } : {}),
    };
  }, [needed, typeIsIds, stageQueries, types, typesQuery.data, nodeKindsQuery.data]);
}

function collectTypeIs(where: readonly ConditionPredicate[], ids: Set<string>): void {
  for (const predicate of where) {
    if (predicate.kind === 'type_is') ids.add(predicate.typeId);
  }
}
