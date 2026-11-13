import { z } from 'zod';

/**
 * Роли актора относительно сущности процесса (вход условий переходов и прав).
 * Словарь ролей задаёт адаптер категории (ADR-0024): у задачи — постановщик/
 * ответственный/соисполнитель/наблюдатель, у письма — регистратор/адресат/
 * исполнитель/расписавший/автор/участник. Вынесено из `workflow.schemas.ts`,
 * чтобы схемы сбора отметок (#434) могли ссылаться на роли без цикла импортов.
 */
export const workflowActorRoleSchema = z.enum([
  'creator',
  'assignee',
  'coexecutor',
  'observer',
  'registrar',
  'addressee',
  'executor',
  'resolver',
  'author',
  'participant',
]);
export type WorkflowActorRole = z.infer<typeof workflowActorRoleSchema>;

/** Словарь ролей по категории типа (Р6): редактор предлагает только свои
 *  роли, проверка документа ловит чужие (`role_not_in_category`). */
export const WORKFLOW_ROLES_BY_CATEGORY = {
  task: ['creator', 'assignee', 'coexecutor', 'observer'],
  letter: ['registrar', 'addressee', 'executor', 'resolver', 'author', 'participant'],
} as const satisfies Record<'task' | 'letter', readonly WorkflowActorRole[]>;
