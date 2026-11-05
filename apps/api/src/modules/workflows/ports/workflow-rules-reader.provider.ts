import { Injectable, Logger } from '@nestjs/common';
import {
  workflowTransitionRulesSchema,
  type DeciderSource,
  type ProcessCategory,
} from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type {
  WorkflowDeciderTransition,
  WorkflowRulesReader,
} from './workflow-rules-reader.port.js';

interface DeciderRuleRow {
  workflowId: string;
  transitionId: string;
  fromStageId: string | null;
  toStageId: string | null;
  toStageSystemState: string | null;
  intent: string;
  rules: unknown;
}

/**
 * Реализация `WORKFLOW_RULES_READER` (#433): один запрос по живым переходам
 * с `decider_in` (jsonb-содержимое массива условий) + разбор общей zod-схемой.
 * Кэша нет: таблица переходов мала, а публикация маршрута должна действовать
 * сразу (в workflows серверного кэша нет — `workflow.repository.ts`).
 * Невалидная строка пропускается с warn: битое правило в чужом маршруте не
 * должно ронять список задач и карточку.
 */
@Injectable()
export class WorkflowRulesReaderProvider implements WorkflowRulesReader {
  private readonly logger = new Logger(WorkflowRulesReaderProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  async deciderTransitions(category: ProcessCategory): Promise<WorkflowDeciderTransition[]> {
    const rows = await this.prisma.$queryRaw<DeciderRuleRow[]>(Prisma.sql`
      SELECT t.workflow_id AS "workflowId",
             t.id AS "transitionId",
             t.from_stage_id AS "fromStageId",
             t.to_stage_id AS "toStageId",
             s.system_state AS "toStageSystemState",
             t.intent AS "intent",
             t.rules AS "rules"
      FROM workflow_transitions t
      JOIN workflows w ON w.id = t.workflow_id
      LEFT JOIN workflow_stages s ON s.id = t.to_stage_id
      WHERE t.archived_at IS NULL
        AND w.kind = ${category}
        AND t.rules->'conditions' @> '[{"kind":"decider_in"}]'::jsonb
    `);

    const result: WorkflowDeciderTransition[] = [];
    for (const row of rows) {
      const parsed = workflowTransitionRulesSchema.safeParse(row.rules ?? {});
      if (!parsed.success) {
        this.logger.warn(
          `Пропущены правила перехода ${row.transitionId}: документ не проходит схему`,
        );
        continue;
      }
      const sources: DeciderSource[] = parsed.data.conditions.flatMap((condition) =>
        condition.kind === 'decider_in' ? [condition.source] : [],
      );
      if (sources.length === 0) continue;
      result.push({
        workflowId: row.workflowId,
        transitionId: row.transitionId,
        fromStageId: row.fromStageId,
        toStageId: row.toStageId,
        toStageSystemState: row.toStageSystemState,
        intent: row.intent === 'service' ? 'service' : 'action',
        sources,
      });
    }
    return result;
  }
}
