import { z } from 'zod';

import { processCategorySchema } from './process-type.schemas.js';
import { taskSystemStateSchema } from './workflow-primitives.schemas.js';

/**
 * Мягкий каталог имён статусов (#430, ADR-0024 п.7): имена того же системного
 * этапа из опубликованных маршрутов категории. `routes` — сколько маршрутов
 * используют имя; на доске одинаковые имена в одном этапе сливаются в одну
 * колонку (это норма), похожие — отдельная колонка (предупреждение).
 */
export const workflowStageNameSchema = z.object({
  systemState: taskSystemStateSchema,
  name: z.string().min(1).max(40),
  routes: z.number().int().min(1),
});
export type WorkflowStageName = z.infer<typeof workflowStageNameSchema>;

export const workflowStageNamesSchema = z.array(workflowStageNameSchema);

export const workflowStageNamesQuerySchema = z.object({
  category: processCategorySchema,
  /** Текущий маршрут не подсказываем сам себе. */
  excludeWorkflowId: z.uuid().optional(),
});
export type WorkflowStageNamesQuery = z.infer<typeof workflowStageNamesQuerySchema>;
