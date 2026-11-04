import { describe, expect, it } from 'vitest';

import {
  workflowStageNameSchema,
  workflowStageNamesQuerySchema,
  workflowStageNamesSchema,
} from './stage-names.schemas.js';

describe('stage-names schemas (#430)', () => {
  it('валидирует имя статуса и счётчик маршрутов', () => {
    expect(
      workflowStageNameSchema.parse({ systemState: 'active', name: 'В работе', routes: 2 }),
    ).toEqual({ systemState: 'active', name: 'В работе', routes: 2 });
    expect(() =>
      workflowStageNameSchema.parse({ systemState: 'active', name: '', routes: 1 }),
    ).toThrow();
    expect(() =>
      workflowStageNameSchema.parse({ systemState: 'active', name: 'В работе', routes: 0 }),
    ).toThrow();
  });

  it('список и query с исключением текущего маршрута', () => {
    expect(
      workflowStageNamesSchema.parse([{ systemState: 'done', name: 'На проверке', routes: 1 }]),
    ).toHaveLength(1);

    const id = '00000000-0000-4000-8000-000000000001';
    expect(workflowStageNamesQuerySchema.parse({ category: 'task' })).toEqual({ category: 'task' });
    expect(
      workflowStageNamesQuerySchema.parse({ category: 'letter', excludeWorkflowId: id }),
    ).toEqual({ category: 'letter', excludeWorkflowId: id });
    expect(() =>
      workflowStageNamesQuerySchema.parse({ category: 'task', excludeWorkflowId: 'x' }),
    ).toThrow();
  });
});
