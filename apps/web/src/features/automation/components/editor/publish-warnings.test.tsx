// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WorkflowDraftDocument, WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { PublishWarnings } from './publish-warnings.js';

afterEach(cleanup);

const document = {
  stages: [
    { id: 's1', name: 'В работе' },
    { id: 's2', name: 'Готово' },
  ],
  transitions: [{ id: 't1', name: 'Завершить' }],
} as unknown as WorkflowDraftDocument;

describe('PublishWarnings: живые предупреждения публикации (#430)', () => {
  it('группирует по коду и показывает имена статусов и кнопок', () => {
    const problems = [
      { code: 'duplicate_stage_name', severity: 'warning', stageId: 's1' },
      { code: 'duplicate_stage_name', severity: 'warning', stageId: 's2' },
      { code: 'empty_name', severity: 'warning', transitionId: 't1' },
    ] as WorkflowProblem[];

    render(<PublishWarnings problems={problems} document={document} />);

    expect(screen.getByText(ui.automation.publishWarnings)).toBeTruthy();
    expect(screen.getByText(ui.automation.problems.duplicate_stage_name)).toBeTruthy();
    expect(screen.getByText('В работе, Готово')).toBeTruthy();
    expect(screen.getByText(ui.automation.problems.empty_name)).toBeTruthy();
    expect(screen.getByText('Завершить')).toBeTruthy();
  });

  it('без проблем ничего не рисует', () => {
    const { container } = render(<PublishWarnings problems={[]} document={document} />);
    expect(container.firstChild).toBeNull();
  });
});
