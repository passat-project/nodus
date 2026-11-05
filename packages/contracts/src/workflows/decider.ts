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
 * руководителя/должности сразу переадресует ожидание).
 */

/** Вид должности — та же пара, что у оргструктуры (`OrgUnitKind`). */
export const deciderPositionKindSchema = z.enum(['management', 'legal']);
export type DeciderPositionKind = z.infer<typeof deciderPositionKindSchema>;

export const deciderSourceSchema = z.discriminatedUnion('kind', [
  /** Держатели должности: несколько — любой; ни одного — вакансия (обход админом). */
  z.object({
    kind: z.literal('position'),
    positionId: z.uuid(),
    positionKind: deciderPositionKindSchema,
  }),
  /** Ближайший активный руководитель автора или исполнителя задачи (В4). */
  z.object({ kind: z.literal('manager_of'), of: z.enum(['creator', 'assignee']) }),
  /** Конкретные сотрудники: несколько — любой. */
  z.object({ kind: z.literal('employees'), userIds: z.array(z.uuid()).min(1).max(50) }),
  /** Поле «Сотрудник»/«Сотрудники» задачи (`cf.<uuid>`). */
  z.object({ kind: z.literal('field'), field: customFieldKeySchema }),
  /** Роль актора в проекте задачи (каталог ролей отменён, ADR-0030). */
  z.object({ kind: z.literal('project_role'), role: projectRoleSchema }),
]);
export type DeciderSource = z.infer<typeof deciderSourceSchema>;

/** Ключ должности актора: вид и id в одной строке сета фактов. */
export function deciderPositionKey(kind: DeciderPositionKind, positionId: string): string {
  return `${kind}:${positionId}`;
}

/**
 * Факты актора В КОНТЕКСТЕ КОНКРЕТНОЙ ЗАДАЧИ. `manager_of` сравнивает
 * ближайшего руководителя автора/исполнителя именно этой задачи, `project_role`
 * — роль в её проекте, `field` — значения её user-полей. Поэтому «факты» не
 * кэшируются между задачами.
 */
export interface WorkflowDeciderFacts {
  userId: string;
  /** Ближайший активный руководитель автора задачи (null — нет). */
  creatorManagerId: string | null;
  /** Ближайший активный руководитель исполнителя задачи (null — нет). */
  assigneeManagerId: string | null;
  /** Должности актора: `deciderPositionKey(kind, positionId)`. */
  positionKeys: ReadonlySet<string>;
  /** Роль актора в проекте задачи (null — не участвует или проекта нет). */
  projectRole: ProjectRole | null;
  /** Значения user-полей задачи: id определения → id сотрудников. */
  fieldUserIds: Readonly<Record<string, readonly string[]>>;
  /** id определений типа `user`/`users` — только они годятся в источник «поле». */
  userFieldIds: ReadonlySet<string>;
}

/** Подходит ли актор под источник. Единственная точка правды для кнопки,
 *  видимости задачи, уведомлений и #438. */
export function matchesDecider(source: DeciderSource, facts: WorkflowDeciderFacts): boolean {
  switch (source.kind) {
    case 'position':
      return facts.positionKeys.has(deciderPositionKey(source.positionKind, source.positionId));
    case 'manager_of': {
      const managerId = source.of === 'creator' ? facts.creatorManagerId : facts.assigneeManagerId;
      return managerId !== null && managerId === facts.userId;
    }
    case 'employees':
      return source.userIds.includes(facts.userId);
    case 'field': {
      const fieldId = customFieldIdOfKey(source.field);
      if (fieldId === null || !facts.userFieldIds.has(fieldId)) return false;
      return (facts.fieldUserIds[fieldId] ?? []).includes(facts.userId);
    }
    case 'project_role':
      return facts.projectRole === source.role;
  }
}
