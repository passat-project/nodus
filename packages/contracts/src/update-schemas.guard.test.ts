import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  updateContactPersonBodySchema,
  updateCounterpartyBodySchema,
} from './counterparties/counterparty.schemas.js';
import { updateDepartmentSchema } from './directory/department.schemas.js';
import { updatePositionSchema } from './directory/position.schemas.js';
import { updateMyProfileSchema, updateUserSchema } from './directory/user.schemas.js';
import { updateNotificationSettingsBodySchema } from './notifications/notifications.schemas.js';

/**
 * Страж схем частичной правки (#492, урок #379): Zod 4 подставляет `.default()`
 * и в необязательные поля, поэтому `.partial()` от схемы создания дописывает
 * в тело PATCH значения создания — сервис пишет их в БД и затирает данные,
 * которых никто не присылал (подразделение уезжало в корень, теряло
 * руководителя и вид).
 *
 * Правило: у каждой схемы правки `parse({ одно поле })` возвращает РОВНО это
 * поле; значения по умолчанию в схемах правки запрещены.
 */

interface UpdateSchemaCase {
  name: string;
  schema: z.ZodType<Record<string, unknown>>;
  /** Минимальное валидное значение одного поля. */
  sample: Record<string, unknown>;
}

const UPDATE_SCHEMAS: UpdateSchemaCase[] = [
  { name: 'updateDepartmentSchema', schema: updateDepartmentSchema, sample: { name: 'Проектное' } },
  {
    name: 'updatePositionSchema',
    schema: updatePositionSchema,
    sample: { name: 'Инженер-проектировщик' },
  },
  {
    name: 'updateCounterpartyBodySchema',
    schema: updateCounterpartyBodySchema,
    sample: { fullName: 'ООО «Ромашка»' },
  },
  {
    name: 'updateContactPersonBodySchema',
    schema: updateContactPersonBodySchema,
    sample: { fullName: 'Иван Петров' },
  },
  {
    name: 'updateNotificationSettingsBodySchema',
    schema: updateNotificationSettingsBodySchema,
    sample: { dndEnabled: true },
  },
  { name: 'updateUserSchema', schema: updateUserSchema, sample: { firstName: 'Иван' } },
  { name: 'updateMyProfileSchema', schema: updateMyProfileSchema, sample: { city: 'Минск' } },
];

describe('схемы частичной правки не дописывают поля', () => {
  for (const { name, schema, sample } of UPDATE_SCHEMAS) {
    it(`${name}: parse({ одно поле }) возвращает только его`, () => {
      const parsed = schema.parse(sample) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(Object.keys(sample).sort());
    });
  }

  it('подразделение и должность: пустое тело отклоняется (400)', () => {
    expect(updateDepartmentSchema.safeParse({}).success).toBe(false);
    expect(updatePositionSchema.safeParse({}).success).toBe(false);
  });

  it('подразделение: явно присланные null/[] очищают поле, отсутствующие — не трогают', () => {
    expect(updateDepartmentSchema.parse({ headId: null })).toEqual({ headId: null });
    expect(updateDepartmentSchema.parse({ deputyIds: [] })).toEqual({ deputyIds: [] });
    expect(updateDepartmentSchema.parse({ parentId: null })).toEqual({ parentId: null });
  });
});
