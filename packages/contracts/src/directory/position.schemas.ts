import { z } from 'zod';

import { orgUnitKindSchema } from './department.schemas.js';

/**
 * Должности (directory.Position) — плоский справочник с kind:
 * management (управленческая, видна в интерфейсе) и legal (юридическая,
 * по трудовой книжке). Удаление жёсткое (вердикт 17.11.2026): имени нет —
 * строки нет; держатели предварительно переназначаются.
 */

export const positionSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kind: orgUnitKindSchema,
  sortOrder: z.number().int(),
});

export type Position = z.infer<typeof positionSchema>;

export const createPositionSchema = z.object({
  name: z.string().trim().min(1).max(256),
  kind: orgUnitKindSchema.default('management'),
  sortOrder: z.number().int().min(0).default(0),
});

export type CreatePositionDto = z.infer<typeof createPositionSchema>;

/**
 * Правка должности: только присланные поля. Не `createPositionSchema.partial()`
 * — Zod 4 подставляет `.default()` и в необязательные поля, поэтому PATCH с одним
 * `name` превращал юридическую должность в управленческую и обнулял порядок
 * (#492, урок #379). `kind` неизменяем после создания (#441): переключение
 * management↔legal оставило бы сотрудников с должностью чужого вида. Пустое
 * тело отклоняется.
 */
export const updatePositionSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field required' });

export type UpdatePositionDto = z.infer<typeof updatePositionSchema>;

/**
 * Переназначение сотрудников должности (#768): ВСЕ сотрудники, включая
 * уволенных, переводятся на другую активную должность того же вида —
 * отдельного архива должностей у уволенных нет, после переназначения на
 * прежнюю должность не ссылается никто и её можно удалить.
 * Целевая должность — не та же самая (проверка на сервере).
 */
export const reassignPositionSchema = z.object({
  targetId: z.uuid(),
});

export type ReassignPositionDto = z.infer<typeof reassignPositionSchema>;
