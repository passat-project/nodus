import { z } from 'zod';

import { lockReasonSchema } from '../forms/field-lock.js';

/**
 * Участники задачи (TaskParticipant). Постановщик и ответственный (ровно
 * один) — поля задачи; здесь — соисполнители и наблюдатели. Менять — постановщик,
 * ответственный, task.manage_any; наблюдатель может снять себя сам. Новый
 * наблюдатель — с выключенным звуком (как Битрикс24).
 */
export const taskParticipantRoleSchema = z.enum(['coexecutor', 'observer']);
export type TaskParticipantRole = z.infer<typeof taskParticipantRoleSchema>;

export const taskParticipantAddBodySchema = z.object({
  userId: z.uuid(),
  role: taskParticipantRoleSchema,
  /** Причина правки закреплённых участников (#496, Р4); у DELETE —
   *  `?lockReason=` (`lockReasonQuerySchema`). */
  lockReason: lockReasonSchema.optional(),
});
export type TaskParticipantAddBody = z.infer<typeof taskParticipantAddBodySchema>;
