import { z } from 'zod';

import { projectColorSchema } from './project.schemas.js';

/**
 * Контракты структуры проекта (#467, ADR-0030 + «Дополнение (#467)»):
 * узлы-папки со свободной вложенностью («папки в проводнике, задачи — файлы»,
 * вердикт владельца 30.10), вид уровня — ярлык (значок+цвет); задачи — листья
 * (`tasks.nodeId`). Узлы БЕЗ архивации: пустой удаляется, непустой — 409.
 * Срез узлов одного проекта без курсорной пагинации (≤ 1000) — легализованное
 * исключение из I7 (дополнение ADR-0030).
 */

/** Значки видов уровней — закрытый список ключей (I15); веб-реестр
 *  `node-kind-icon.tsx` отображает ключ на lucide-иконку (рассинхрон ключа и
 *  реестра = ошибка типов, паттерн process-type-icon.tsx). */
export const nodeKindIconSchema = z.enum([
  'folder',
  'folderTree',
  'layers',
  'building',
  'building2',
  'landmark',
  'boxes',
  'box',
  'listTree',
  'flag',
  'milestone',
  'factory',
  'route',
  'squareStack',
]);
export type NodeKindIcon = z.infer<typeof nodeKindIconSchema>;

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
  /** Видов уровней в подсказке типа проекта. */
  levelKindsPerType: 10,
} as const;

/** Вид уровня — ярлык узла (значок + цвет). Справочник «Автоматизации»;
 *  удаление = архивация (узлы архивного вида создавать нельзя, существующие
 *  живут). Посев миграцией: стадия, очередь, пусковой комплекс, здание по
 *  генплану, раздел, этап (ТКП 45-1.02-295). */
export const nodeKindSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  icon: nodeKindIconSchema,
  color: projectColorSchema,
  archivedAt: z.iso.datetime().nullable(),
});

export type NodeKind = z.infer<typeof nodeKindSchema>;

export const nodeKindListSchema = z.array(nodeKindSchema);
export type NodeKindList = z.infer<typeof nodeKindListSchema>;

/** Название вида уникально без учёта регистра и пробелов (lower(btrim(name))). */
export const nodeKindCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: nodeKindIconSchema,
  color: projectColorSchema,
});

export type NodeKindCreateBody = z.infer<typeof nodeKindCreateBodySchema>;

export const nodeKindUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: nodeKindIconSchema.optional(),
    color: projectColorSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type NodeKindUpdateBody = z.infer<typeof nodeKindUpdateBodySchema>;

/** Агрегаты ПРЯМЫХ задач узла (группировка по node_id на сервере, порт
 *  TASK_PROJECT_READER.nodeRollups); суммы поддерева клиент собирает по
 *  дереву (узлов ≤ 1000 — точный пересчёт на клиенте). Завершённость — канон
 *  isCompletedState (closed && outcome IS DISTINCT FROM 'cancelled').
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

/** Узел дерева проекта — папка-агрегат: без полей, ответственного, срока и
 *  чата (вердикты 24–25.10); вид уровня — ярлык, порядок — fractional-ключ
 *  (COLLATE "C"). */
export const projectNodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kindId: z.uuid(),
  name: z.string().min(1).max(NODE_LIMITS.nameLength),
  /** Шифр узла (уникален в проекте, nullable — не задан). */
  code: z.string().min(1).max(NODE_LIMITS.codeLength).nullable(),
  rollup: projectNodeRollupSchema,
  createdAt: z.iso.datetime(),
});

export type ProjectNode = z.infer<typeof projectNodeSchema>;

/** GET /projects/:id/structure: узлы (плоский список, клиент собирает дерево)
 *  + виды уровней (для ярлыков). Задачи-листья — существующим фидом
 *  GET /tasks?projectId= (ADR-0030 п.7, сборка дерева на клиенте). */
export const projectStructureResponseSchema = z.object({
  nodes: z.array(projectNodeSchema),
  kinds: nodeKindListSchema,
});

export type ProjectStructureResponse = z.infer<typeof projectStructureResponseSchema>;

export const createProjectNodeBodySchema = z.object({
  parentId: z.uuid().nullable().optional(),
  kindId: z.uuid(),
  name: z.string().trim().min(1).max(NODE_LIMITS.nameLength),
  code: z.string().trim().min(1).max(NODE_LIMITS.codeLength).optional(),
});

export type CreateProjectNodeBody = z.infer<typeof createProjectNodeBodySchema>;

/** Пакетное создание: «Здания: поз. 1–3» — имена собирает клиент, сервер
 *  принимает готовый список (≤ NODE_LIMITS.batch). */
export const batchCreateProjectNodesBodySchema = z.object({
  parentId: z.uuid().nullable().optional(),
  kindId: z.uuid(),
  names: z
    .array(z.string().trim().min(1).max(NODE_LIMITS.nameLength))
    .min(1)
    .max(NODE_LIMITS.batch),
});

export type BatchCreateProjectNodesBody = z.infer<typeof batchCreateProjectNodesBodySchema>;

export const batchCreateProjectNodesResponseSchema = z.object({
  nodes: z.array(projectNodeSchema),
});

export type BatchCreateProjectNodesResponse = z.infer<typeof batchCreateProjectNodesResponseSchema>;

/** Правка узла: имя/код/вид-ярлык (порядок и родитель — move). null очищает код. */
export const updateProjectNodeBodySchema = z
  .object({
    name: z.string().trim().min(1).max(NODE_LIMITS.nameLength).optional(),
    code: z.string().trim().min(1).max(NODE_LIMITS.codeLength).nullable().optional(),
    kindId: z.uuid().optional(),
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
