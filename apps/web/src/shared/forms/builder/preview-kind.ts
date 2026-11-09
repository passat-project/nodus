import type { CustomFieldType } from '@nodus/contracts';

import type { PreviewKind } from './builder-host.js';

/** Облик контрола атрибута в превью редактора окна (#496). */
export function previewOfFieldType(type: CustomFieldType): PreviewKind {
  switch (type) {
    case 'text':
    case 'link':
    case 'counter':
      return 'input';
    case 'long_text':
      return 'text';
    case 'number':
    case 'money':
    case 'duration':
      return 'number';
    case 'date':
    case 'datetime':
      return 'date';
    case 'user':
    case 'users':
      return 'people';
    case 'bool':
      return 'toggle';
    default:
      return 'select';
  }
}
