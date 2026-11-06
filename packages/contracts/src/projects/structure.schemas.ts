import { z } from 'zod';

import { customFieldRefSchema } from '../custom-fields/custom-field-refs.js';
import { customFieldFormulasSchema } from '../custom-fields/formula-api.schemas.js';
import {
  customFieldValuesInputSchema,
  customFieldValuesPatchSchema,
  customFieldValuesSchema,
} from '../custom-fields/custom-field-values.js';
import { nodeKindListSchema } from './node-kind.schemas.js';

/**
 * Контракты структуры проекта (#467, ADR-0030 + «Дополнение (#467)»):
 * узлы-папки со свободной вложенностью («папки в проводнике, задачи — файлы»,
 * вердикт владельца 30.10); вид папки — настраиваемый тип (#556, форма и
 * возможности — `node-kind.schemas.ts`); задачи — листья (`tasks.nodeId`).
 * Узлы БЕЗ архивации: пустой удаляется, непустой — 409. Срез узлов одного
 * проекта без курсорной пагинации (≤ 1000) — легализованное исключение из I7
 * (дополнение ADR-0030).
 */

/** Лимиты структуры (допущения техплана #467). */
export const NODE_LIMITS = {
  /** Узлов на проект (срез отдаётся целиком, без курсора). */
  nodesPerProject: 1000,
  /** Максимальная глубина вложенности узлов. */
  depth: 10,
  /** Детей у одного узла. */
  childrenPerParent: 100,
  /** Узлов в одном пакетном создании. */
  batch: 50,
  nameLength: 200,
  codeLength: 64,
} as const;

/** Агрегаты ПРЯМЫХ задач узла (группировка по node_id на сервере, порт
 *  TASK_PROJECT_READER.nodeRollups); суммы поддерева клиент собирает по
 *  дереву (узлов ≤ 1000 — точный пересчёт на клиенте). Завершённость — канон
 *  isCompletedState (closed && outcome не cancelled/rejected, #430).
 *  nearestDeadline — MIN(deadline) открытых задач; latestDeadline — MAX(deadline)
 *  всех задач узла (ближайший «горящий» и поздний «крайний»). */
export const projectNodeRollupSchema = z.object({
  taskCount: z.number().int().min(0),
  doneCount: z.number().int().min(0),
  /** Плановые трудозатраты, минуты (I14). */
  plannedMinutes: z.number().int().min(0),
  spentMinutes: z.number().int().min(0),
  nearestDeadline: z.iso.datetime().nullable(),
  latestDeadline: z.iso.datetime().nullable(),
});

export type ProjectNodeRollup = z.infer<typeof projectNodeRollupSchema>;

/** Папка дерева проекта — агрегат работ: без ответственного, срока и чата
 *  (вердикты 24–25.10); вид — настраиваемый тип (#556), порядок —
 *  fractional-ключ (COLLATE "C"). `customFields` — ВСЕ хранимые значения,
 *  включая скрытые сменой вида; для формы вида читать через `nodeFormValues`
 *  (Р5). */
export const projectNodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kindId: z.uuid(),
  name: z.string().min(1).max(NODE_LIMITS.nameLength),
  /** Код папки — производная атрибута «Код» (nullable — не задан;
   *  уникальность снята В2 #631). */
  code: z.string().min(1).max(NODE_LIMITS.codeLength).nullable(),
  customFields: customFieldValuesSchema,
  /** Формульные ячейки узла (#632): своя/типовая формула и ошибка. */
  customFieldFormulas: customFieldFormulasSchema.optional(),
  rollup: projectNodeRollupSchema,
  createdAt: z.iso.datetime(),
});

export type ProjectNode = z.infer<typeof projectNodeSchema>;

/** GET /projects/:id/structure: папки (плоский список, клиент собирает
 *  дерево) + виды папок (ярлыки и форма) + ссылки значений одним срезом
 *  (О2: N+1 не нужен потребителям). Задачи-листья — существующим фидом
 *  GET /tasks?projectId= (ADR-0030 п.7, сборка дерева на клиенте). */
export const projectStructureResponseSchema = z.object({
  nodes: z.array(projectNodeSchema),
  kinds: nodeKindListSchema,
  customFieldRefs: z.array(customFieldRefSchema),
});

export type ProjectStructureResponse = z.infer<typeof projectStructureResponseSchema>;

export const createProjectNodeBodySchema = z.object({
  parentId: z.uuid().nullable().optional(),
  kindId: z.uuid(),
  name: z.string().trim().min(1).max(NODE_LIMITS.nameLength),
  code: z.string().trim().min(1).max(NODE_LIMITS.codeLength).optional(),
  /** Значения атрибутов формы вида (#556): проверяет сервер (порт реестра). */
  customFields: customFieldValuesInputSchema.optional(),
});

export type CreateProjectNodeBody = z.infer<typeof createProjectNodeBodySchema>;

/** Пакетное создание: «Здания: поз. 1–3» — имена собирает клиент, сервер
 *  принимает готовый список (≤ NODE_LIMITS.batch). Значения атрибутов общие
 *  для всей пачки; шифр при обязательном шифре вида — 422 (В1, Р6). */
export const batchCreateProjectNodesBodySchema = z.object({
  parentId: z.uuid().nullable().optional(),
  kindId: z.uuid(),
  names: z
    .array(z.string().trim().min(1).max(NODE_LIMITS.nameLength))
    .min(1)
    .max(NODE_LIMITS.batch),
  customFields: customFieldValuesInputSchema.optional(),
});

export type BatchCreateProjectNodesBody = z.infer<typeof batchCreateProjectNodesBodySchema>;

export const batchCreateProjectNodesResponseSchema = z.object({
  nodes: z.array(projectNodeSchema),
});

export type BatchCreateProjectNodesResponse = z.infer<typeof batchCreateProjectNodesResponseSchema>;

/** Правка папки: имя/шифр/вид/значения (порядок и родитель — move).
 *  `null` очищает шифр или значение атрибута; смена вида значения прежнего
 *  вида не стирает — они скрываются (Р6). */
export const updateProjectNodeBodySchema = z
  .object({
    name: z.string().trim().min(1).max(NODE_LIMITS.nameLength).optional(),
    code: z.string().trim().min(1).max(NODE_LIMITS.codeLength).nullable().optional(),
    kindId: z.uuid().optional(),
    customFields: customFieldValuesPatchSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type UpdateProjectNodeBody = z.infer<typeof updateProjectNodeBodySchema>;

/** Перенос узла (DnD/меню): родитель + позиция среди его детей. `beforeId` /
 *  `afterId` — сосед-якорь в ЦЕЛЕВОМ родителе (не более одного); без якоря —
 *  в конец. parentId=null — корень проекта. */
export const moveProjectNodeBodySchema = z
  .object({
    parentId: z.uuid().nullable(),
    beforeId: z.uuid().nullable().optional(),
    afterId: z.uuid().nullable().optional(),
  })
  .refine((v) => !(v.beforeId && v.afterId), { message: 'at most one anchor' });

export type MoveProjectNodeBody = z.infer<typeof moveProjectNodeBodySchema>;
