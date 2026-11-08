import type { CustomFieldType } from '@nodus/contracts';

/**
 * Семейства типов полей (#431, Р1; ссылки на записи — #631 Р5): 19 типов →
 * 16 плиток «Нового поля». Модификаторы («Многострочный», «Несколько
 * значений») — односторонние расширения одного семейства (Р3): обратно
 * только новым полем.
 */
export const FIELD_FAMILIES = [
  'text',
  'number',
  'money',
  'date',
  'datetime',
  'duration',
  'bool',
  'list',
  'employee',
  'department',
  'project',
  'counterparty',
  'task',
  'letter',
  'node',
  'link',
  'counter',
] as const;

export type FieldFamily = (typeof FIELD_FAMILIES)[number];

/** Базовый тип семейства (создание поля и возврат к простому виду). */
const BASE_TYPE: Record<FieldFamily, CustomFieldType> = {
  text: 'text',
  number: 'number',
  money: 'money',
  date: 'date',
  datetime: 'datetime',
  duration: 'duration',
  bool: 'bool',
  list: 'enum',
  employee: 'user',
  department: 'department',
  project: 'project',
  counterparty: 'counterparty',
  task: 'task',
  letter: 'letter',
  node: 'node',
  link: 'link',
  counter: 'counter',
};

export function familyOf(type: CustomFieldType): FieldFamily {
  switch (type) {
    case 'text':
    case 'long_text':
      return 'text';
    case 'enum':
    case 'multienum':
      return 'list';
    case 'user':
    case 'users':
      return 'employee';
    default:
      return type;
  }
}

export function baseTypeOf(family: FieldFamily): CustomFieldType {
  return BASE_TYPE[family];
}

/** Модификатор типа: многострочность или множественность (null — нет). */
export function modifierOf(type: CustomFieldType): 'multiline' | 'multiple' | null {
  if (type === 'long_text') return 'multiline';
  if (type === 'multienum' || type === 'users') return 'multiple';
  return null;
}

/** Тип с включённым модификатором семейства (расширение, Р3). */
export function typeWithModifier(
  family: FieldFamily,
  modifier: 'multiline' | 'multiple',
): CustomFieldType {
  if (modifier === 'multiline' && family === 'text') return 'long_text';
  if (modifier === 'multiple' && family === 'list') return 'multienum';
  if (modifier === 'multiple' && family === 'employee') return 'users';
  return baseTypeOf(family);
}

/** Семейство вообще имеет модификатор (для переключателя в редакторе). */
export function familyModifier(family: FieldFamily): 'multiline' | 'multiple' | null {
  if (family === 'text') return 'multiline';
  if (family === 'list' || family === 'employee') return 'multiple';
  return null;
}
