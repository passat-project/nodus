import { Injectable } from '@nestjs/common';
import type { TaskSystemState, WorkflowStageName, WorkflowStageNamesQuery } from '@nodus/contracts';

import { WorkflowRepository } from '../workflow.repository.js';

/**
 * Мягкий каталог имён статусов (#430, ADR-0024 п.7): имена того же этапа из
 * системного каталога и опубликованных маршрутов категории со счётчиком
 * маршрутов. Это подсказка, не жёсткий справочник: публикация только
 * предупреждает о совпадениях.
 */
@Injectable()
export class WorkflowStageNamesService {
  constructor(private readonly workflows: WorkflowRepository) {}

  async list(query: WorkflowStageNamesQuery): Promise<WorkflowStageName[]> {
    const rows = await this.workflows.stageNames(query.category, query.excludeWorkflowId);
    return rows.map((row) => ({
      systemState: row.systemState as TaskSystemState,
      name: row.name,
      routes: row.routes,
      published: row.published,
    }));
  }
}
