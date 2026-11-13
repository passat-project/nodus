import { z } from 'zod';

import { customFieldIdOfKey, customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { projectRoleSchema, type ProjectRole } from '../projects/project.schemas.js';

/**
 * Источники решающих (#433, ADR-0025 §3-4): человек вне задачи, который видит
 * шаг и может нажать его кнопку. Реестр ЗАКРЫТ: новый источник = расширение
 * union + ветка `matchesDecider` + проверка документа. Движок, видимость и
 * будущая проекция #438 используют ОДНУ функцию — расхождение «кто видит
 * кнопку» и «кто видит задачу» недопустимо.
 *
 * Снимка решающих нет: источники вычисляются на момент проверки (смена
 * руководителя/роли сразу переадресует ожидание).
 *
 * Должность как источник удалена (#806, 13.11.2026): «любой держатель» не равен
 * ответственному за проект; остаются руководитель, конкретные сотрудники,
 * поле «Сотрудник(и)» и роль в проекте. Пустой список сотрудников — вакансия
 * (кнопку видит только обладатель обхода), публикация его не пропускает.
 */

export const deciderSourceSchema = z.discriminatedUnion('kind', [
  /** Ближайший активный руководитель автора или исполнителя задачи (В4). */
  z.object({ kind: z.literal('manager_of'), of: z.enum(['creator', 'assignee']) }),
  /** Конкретные сотрудники: несколько — любой; пусто — вакансия (обход админом). */
  z.object({ kind: z.literal('employees'), userIds: z.array(z.uuid()).max(50) }),
  /** Поле «Сотрудник»/«Сотрудники» задачи (`cf.<uuid>`). */
  z.object({ kind: z.literal('field'), field: customFieldKeySchema }),
  /** Роль актора в проекте задачи (каталог ролей отменён, ADR-0030). */
  z.object({ kind: z.literal('project_role'), role: projectRoleSchema }),
]);
export type DeciderSource = z.infer<typeof deciderSourceSchema>;

/**
 * Факты актора В КОНТЕКСТЕ КОНКРЕТНОЙ ЗАДАЧИ. `manager_of` сравнивает
 * ближайшего руководителя автора/исполнителя именно этой задачи, `project_role`
 * — роль в её проекте, `field` — значения её user-полей. Поэтому «факты» не
 * кэшируются между задачами.
 */
export interface WorkflowDeciderFacts {
  userId: string;
  /** Постановщик и ответственный задачи: не могут быть решающими по полю —
   *  иначе автор сам впишет себя и нажмёт свою кнопку (В7). */
  creatorId: string;
  assigneeId: string;
  /** Ближайший активный руководитель автора задачи (null — нет). */
  creatorManagerId: string | null;
  /** Ближайший активный руководитель исполнителя задачи (null — нет). */
  assigneeManagerId: string | null;
  /** Все роли актора в проекте задачи (participant объединяет task|member;
   *  менеджер с дополнительной строкой `task` остаётся и participant). */
  projectRoles: ReadonlySet<ProjectRole>;
  /** Значения user-полей задачи: id определения → id сотрудников. */
  fieldUserIds: Readonly<Record<string, readonly string[]>>;
  /** id определений типа `user`/`users` — только они годятся в источник «поле». */
  userFieldIds: ReadonlySet<string>;
}

/** Подходит ли актор под источник. Единственная точка правды для кнопки,
 *  видимости задачи, уведомлений и #438. */
export function matchesDecider(source: DeciderSource, facts: WorkflowDeciderFacts): boolean {
  switch (source.kind) {
    case 'manager_of': {
      const managerId = source.of === 'creator' ? facts.creatorManagerId : facts.assigneeManagerId;
      return managerId !== null && managerId === facts.userId;
    }
    case 'employees':
      return source.userIds.includes(facts.userId);
    case 'field': {
      // Автор/ответственный правят поля задачи — по полю они не решающие,
      // иначе самопровозглашение (решение владельца 05.11.2026).
      if (facts.userId === facts.creatorId || facts.userId === facts.assigneeId) return false;
      const fieldId = customFieldIdOfKey(source.field);
      if (fieldId === null || !facts.userFieldIds.has(fieldId)) return false;
      return (facts.fieldUserIds[fieldId] ?? []).includes(facts.userId);
    }
    case 'project_role':
      return facts.projectRoles.has(source.role);
  }
}
