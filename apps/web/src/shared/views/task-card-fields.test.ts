import { describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { makeTaskCardFields } from './task-card-fields.js';

describe('makeTaskCardFields (#403)', () => {
  it('тип задачи — поле карточки, видимое по умолчанию', () => {
    expect(makeTaskCardFields().find((f) => f.id === 'type')).toMatchObject({
      id: 'type',
      label: ui.tasks.fieldType,
      defaultVisible: true,
    });
  });
});
