import { describe, expect, it } from 'vitest';
import type { WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { pressSummary } from './transition-press-section.js';

const transition = (press: WorkflowDraftTransition['press']): WorkflowDraftTransition =>
  ({
    id: 't1',
    code: null,
    name: 'Завершить',
    fromStageId: 's1',
    toStageId: 's2',
    display: 'primary',
    intent: 'action',
    sortOrder: 0,
    rules: { conditions: [], validators: [], postFunctions: [] },
    form: { enabled: false, sections: [] },
    press,
  }) as WorkflowDraftTransition;

describe('сводка «Кнопку жмут несколько» (#434)', () => {
  it('без настройки — «Выключено»', () => {
    expect(pressSummary(transition(undefined))).toBe(ui.automation.press.summaryOff);
  });

  it('без источников — «Не настроено»', () => {
    expect(
      pressSummary(
        transition({
          sources: [],
          quorum: { kind: 'all' },
          order: 'parallel',
          excludeAuthor: true,
        }),
      ),
    ).toBe(ui.automation.press.summaryEmpty);
  });

  it('показывает источник, кворум и порядок', () => {
    const summary = pressSummary(
      transition({
        sources: [{ kind: 'coexecutors' }],
        quorum: { kind: 'all' },
        order: 'parallel',
        excludeAuthor: true,
      }),
    );
    expect(summary).toContain(ui.automation.press.sources.coexecutors);
    expect(summary).toContain(ui.automation.press.quorum.all);
    expect(summary).toContain(ui.automation.press.order.parallel);
  });
});
