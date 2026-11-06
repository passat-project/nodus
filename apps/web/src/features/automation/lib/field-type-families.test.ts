import { describe, expect, it } from 'vitest';

import {
  FIELD_FAMILIES,
  baseTypeOf,
  familyModifier,
  familyOf,
  modifierOf,
  typeWithModifier,
} from './field-type-families.js';

describe('семейства типов полей (#431)', () => {
  it('16 плиток «Нового поля», 19 типов сводятся в семейства (Р5 #631)', () => {
    expect(FIELD_FAMILIES).toHaveLength(16);
    expect(familyOf('text')).toBe('text');
    expect(familyOf('long_text')).toBe('text');
    expect(familyOf('enum')).toBe('list');
    expect(familyOf('multienum')).toBe('list');
    expect(familyOf('user')).toBe('employee');
    expect(familyOf('users')).toBe('employee');
    expect(familyOf('department')).toBe('department');
    expect(familyOf('task')).toBe('task');
    expect(familyOf('letter')).toBe('letter');
    expect(familyOf('node')).toBe('node');
  });

  it('базовый тип семейства — простой вид', () => {
    expect(baseTypeOf('text')).toBe('text');
    expect(baseTypeOf('list')).toBe('enum');
    expect(baseTypeOf('employee')).toBe('user');
    expect(baseTypeOf('project')).toBe('project');
  });

  it('модификаторы: многострочность и множественность', () => {
    expect(modifierOf('long_text')).toBe('multiline');
    expect(modifierOf('multienum')).toBe('multiple');
    expect(modifierOf('users')).toBe('multiple');
    expect(modifierOf('text')).toBeNull();
    expect(typeWithModifier('text', 'multiline')).toBe('long_text');
    expect(typeWithModifier('list', 'multiple')).toBe('multienum');
    expect(typeWithModifier('employee', 'multiple')).toBe('users');
    expect(typeWithModifier('number', 'multiple')).toBe('number');
  });

  it('модификатор есть только у трёх семейств', () => {
    expect(familyModifier('text')).toBe('multiline');
    expect(familyModifier('list')).toBe('multiple');
    expect(familyModifier('employee')).toBe('multiple');
    expect(familyModifier('money')).toBeNull();
  });
});
