import { describe, expect, it } from 'vitest';

import { nodeKindBaseSchema, nodeKindCreateBodySchema } from './node-kind.schemas.js';
import { projectTypeBaseSchema, projectTypeCreateBodySchema } from './project.schemas.js';

/** Основа копии (#857): union «копия живой основы | с нуля» у типов проектов
 *  и видов папок — зеркало `processTypeBaseSchema`. Форма при копировании
 *  берётся у основы, дубль в теле — ошибка валидации. */

const TYPE = '11111111-1111-4111-8111-111111111111';
const KIND = '22222222-2222-4222-8222-222222222222';
const FIELD = '33333333-3333-4333-8333-333333333333';

describe('projectTypeBaseSchema (#857)', () => {
  it('копия и simple парсятся; невалидное base отвергнуто', () => {
    expect(projectTypeBaseSchema.parse({ kind: 'copy', typeId: TYPE })).toEqual({
      kind: 'copy',
      typeId: TYPE,
    });
    expect(projectTypeBaseSchema.parse({ kind: 'simple' })).toEqual({ kind: 'simple' });
    expect(projectTypeBaseSchema.safeParse({ kind: 'copy' }).success).toBe(false);
    expect(projectTypeBaseSchema.safeParse({ kind: 'copy', typeId: 'не-uuid' }).success).toBe(
      false,
    );
    expect(projectTypeBaseSchema.safeParse({ kind: 'fork', typeId: TYPE }).success).toBe(false);
  });

  it('base опционален; при копировании форма из тела запрещена (основа — источник)', () => {
    expect(projectTypeCreateBodySchema.safeParse({ name: 'Тендер' }).success).toBe(true);
    expect(
      projectTypeCreateBodySchema.safeParse({ name: 'Тендер', base: { kind: 'simple' } }).success,
    ).toBe(true);
    expect(
      projectTypeCreateBodySchema.safeParse({
        name: 'Тендер',
        form: { fields: [{ fieldId: FIELD, state: 'optional' }] },
      }).success,
    ).toBe(true);
    const copied = projectTypeCreateBodySchema.safeParse({
      name: 'Копия',
      base: { kind: 'copy', typeId: TYPE },
      form: { fields: [{ fieldId: FIELD, state: 'optional' }] },
    });
    expect(copied.success).toBe(false);
  });
});

describe('nodeKindBaseSchema (#857)', () => {
  it('копия и simple парсятся; невалидное base отвергнуто', () => {
    expect(nodeKindBaseSchema.parse({ kind: 'copy', kindId: KIND })).toEqual({
      kind: 'copy',
      kindId: KIND,
    });
    expect(nodeKindBaseSchema.parse({ kind: 'simple' })).toEqual({ kind: 'simple' });
    expect(nodeKindBaseSchema.safeParse({ kind: 'copy' }).success).toBe(false);
    expect(nodeKindBaseSchema.safeParse({ kind: 'copy', kindId: 42 }).success).toBe(false);
  });

  it('create body принимает base и не теряет ярлык', () => {
    const parsed = nodeKindCreateBodySchema.parse({
      name: 'Комплект',
      icon: 'fileText',
      color: 'blue',
      base: { kind: 'copy', kindId: KIND },
    });
    expect(parsed.base).toEqual({ kind: 'copy', kindId: KIND });
    expect(nodeKindCreateBodySchema.safeParse({ name: 'Комплект', icon: 'fileText' }).success).toBe(
      false,
    );
  });
});
