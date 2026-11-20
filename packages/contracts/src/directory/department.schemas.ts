import { z } from 'zod';

/**
 * Подразделения (directory.Department) — дерево оргструктуры.
 * kind=management — управленческая структура (по ней работают БП и задачи);
 * kind=legal — юридическая (трудовая книжка; эпик M2 #18: структуры расходятся).
 * У подразделения — руководитель (headId) и ЗАМЕСТИТЕЛИ (связь
 * `department_deputies`, #817): несколько человек, порядок — порядок добавления.
 */

export const orgUnitKindSchema = z.enum(['management', 'legal']);
export type OrgUnitKind = z.infer<typeof orgUnitKindSchema>;

export const departmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kind: orgUnitKindSchema,
  parentId: z.uuid().nullable(),
  headId: z.uuid().nullable(),
  /** Заместители в порядке назначения (связь `department_deputies`). */
  deputyIds: z.array(z.uuid()),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});

export type Department = z.infer<typeof departmentSchema>;

/** Заместитель подразделения с денормализованным именем для UI. */
export const departmentDeputySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
});

export type DepartmentDeputy = z.infer<typeof departmentDeputySchema>;

/** Узел дерева оргструктуры (рекурсивный) с денормализованными именами для UI. */
export const departmentNodeSchema: z.ZodType<DepartmentNode> = z.lazy(() =>
  departmentSchema.extend({
    headName: z.string().nullable(),
    deputies: z.array(departmentDeputySchema),
    /** Число активных сотрудников, прикреплённых к подразделению (не рекурсивно). */
    memberCount: z.number().int().nonnegative(),
    children: z.array(departmentNodeSchema),
  }),
);

export interface DepartmentNode extends Department {
  headName: string | null;
  deputies: DepartmentDeputy[];
  memberCount: number;
  children: DepartmentNode[];
}

/**
 * Запрос дерева оргструктуры (UI «Подразделения», #84): какая из пары
 * структур (kind) нужна; ответ — лес корней DepartmentNode (children рекурсивно).
 * Бэкенд: GET /api/v1/directory/departments/tree?kind=…
 */
export const departmentTreeQuerySchema = z.object({
  kind: orgUnitKindSchema.default('management'),
});

export type DepartmentTreeQuery = z.infer<typeof departmentTreeQuerySchema>;

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(256),
  kind: orgUnitKindSchema.default('management'),
  parentId: z.uuid().nullable().default(null),
  headId: z.uuid().nullable().default(null),
  /** Ни одного: пустой массив — «без заместителей» (значение по умолчанию). */
  deputyIds: z.array(z.uuid()).default([]),
  sortOrder: z.number().int().min(0).default(0),
});

export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;

/**
 * Правка подразделения: только присланные поля. Не `createDepartmentSchema.partial()`
 * — Zod 4 подставляет `.default()` и в необязательные поля, поэтому PATCH с одним
 * `name` затирал родителя, руководителя, заместителей, вид и порядок (#492, урок #379).
 * Пустое тело отклоняется: правка без полей — ошибка клиента, а не no-op.
 * `deputyIds` — ПОЛНЫЙ набор заместителей (пустой массив снимает всех); отсутствие
 * ключа набор не трогает. Дубли отсекает сервис (порядок первого вхождения).
 * kind НЕ входит: вид структуры неизменяем после создания — переключение
 * management↔legal «усыпляло»/реактивировало привязки ролей в обход bind (#490);
 * права подразделения считает только management-цепочка. Неизвестные ключи
 * zod отбрасывает.
 */
export const updateDepartmentSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    parentId: z.uuid().nullable().optional(),
    headId: z.uuid().nullable().optional(),
    deputyIds: z.array(z.uuid()).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field required' });

export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;
