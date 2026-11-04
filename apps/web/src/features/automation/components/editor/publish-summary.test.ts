import { describe, expect, it } from 'vitest';
import type { WorkflowDraftDocument } from '@nodus/contracts';

import { publishSummary } from './publish-dialog.js';

const stage = (overrides: Partial<WorkflowDraftDocument['stages'][number]> = {}) => ({
  id: 's1',
  code: null,
  name: 'В работе',
  color: 'info' as const,
  systemState: 'active' as const,
  outcome: null,
  isInitial: true,
  sortOrder: 0,
  ...overrides,
});

const transition = (overrides: Partial<WorkflowDraftDocument['transitions'][number]> = {}) => ({
  id: 't1',
  code: null,
  name: 'Завершить',
  fromStageId: 's1',
  toStageId: 's2',
  display: 'primary' as const,
  intent: 'action' as const,
  sortOrder: 0,
  rules: { conditions: [], validators: [], postFunctions: [] },
  form: { enabled: false, sections: [] },
  ...overrides,
});

describe('publishSummary (#430)', () => {
  it('изменение итога/смысла кнопки видно в сводке', () => {
    const baseline: WorkflowDraftDocument = {
      stages: [
        stage(),
        stage({ id: 's2', name: 'Итог', systemState: 'closed', outcome: 'success' }),
      ],
      transitions: [transition()],
    };
    const next: WorkflowDraftDocument = {
      stages: [
        stage(),
        stage({ id: 's2', name: 'Итог', systemState: 'closed', outcome: 'rejected' }),
      ],
      transitions: [transition({ intent: 'service' })],
    };
    const summary = publishSummary(baseline, next);
    expect(summary).toContain('статус изменён');
    expect(summary).toContain('кнопка изменена');
  });
});
