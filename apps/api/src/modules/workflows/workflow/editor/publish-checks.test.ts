import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import type { LoadedWorkflow } from '../workflow.repository.js';
import { serverChecksOf } from './publish-checks.js';

/** Серверные проверки публикации: ссылки документа — только свои (#378). */

const WF = '00000000-0000-4000-8000-0000000000f1';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';

const loaded = (): LoadedWorkflow => ({
  id: WF,
  stages: [
    {
      id: S1,
      code: null,
      name: 'В работе',
      color: 'success',
      sortOrder: 0,
      systemState: 'active',
      outcome: null,
      isInitial: true,
      workflowId: WF,
      archivedAt: null,
    },
    {
      id: S2,
      code: null,
      name: 'Завершена',
      color: 'info',
      sortOrder: 1,
      systemState: 'closed',
      outcome: 'success',
      isInitial: false,
      workflowId: WF,
      archivedAt: null,
    },
  ],
  transitions: [],
  actions: [
    {
      id: A1,
      name: 'Запросить уточнение',
      stageId: S1,
      display: 'button',
      sortOrder: 0,
      rules: { conditions: [], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
      steps: [],
    },
  ],
});

const document = (partial: Record<string, unknown>) =>
  ({
    stages: [
      {
        id: S1,
        code: null,
        name: 'В работе',
        color: 'success',
        systemState: 'active',
        outcome: null,
        isInitial: true,
        sortOrder: 0,
      },
      {
        id: S2,
        code: null,
        name: 'Завершена',
        color: 'info',
        systemState: 'closed',
        outcome: 'success',
        isInitial: false,
        sortOrder: 1,
      },
    ],
    transitions: [],
    ...partial,
  }) as never;

const action = (partial: Record<string, unknown> = {}) => ({
  id: 'new:00000000-0000-4000-8000-0000000000a9',
  code: null,
  name: 'Запросить уточнение',
  stageId: S1,
  display: 'button',
  sortOrder: 0,
  rules: {
    conditions: [{ kind: 'role_in', roles: ['assignee'] }],
    validators: [],
    postFunctions: [],
  },
  form: { enabled: true, sections: [] },
  steps: [],
  ...partial,
});

describe('serverChecksOf — действия (#633)', () => {
  it('свои действия и статус документа проходят', () => {
    expect(() => serverChecksOf(loaded(), document({ actions: [action()] }), [])).not.toThrow();
  });

  it('действие ссылается на чужой/неизвестный статус — WORKFLOW_INVALID', () => {
    expect(() =>
      serverChecksOf(loaded(), document({ actions: [action({ stageId: 'other-stage' })] }), []),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.WORKFLOW_INVALID,
        message: expect.stringContaining('Action stage'),
      }),
    );
  });

  it('uuid действия чужого маршрута — WORKFLOW_INVALID', () => {
    expect(() => serverChecksOf(loaded(), document({ actions: [action({ id: A2 })] }), [])).toThrow(
      expect.objectContaining({
        code: ErrorCode.WORKFLOW_INVALID,
        message: expect.stringContaining('foreign actions'),
      }),
    );
  });

  it('живое действие своего маршрута по uuid проходит', () => {
    expect(() =>
      serverChecksOf(loaded(), document({ actions: [action({ id: A1 })] }), []),
    ).not.toThrow();
  });
});
