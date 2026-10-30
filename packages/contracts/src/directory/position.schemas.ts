import { z } from 'zod';

import { orgUnitKindSchema } from './department.schemas.js';

/**
 * Должности (directory.Position) — плоский справочник с kind:
 * management (управленческая, видна в интерфейсе) и legal (юридическая,
 * по трудовой книжке). Удаления нет — только архивация (isActive, I15).
 */

export const positionSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kind: orgUnitKindSchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
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
