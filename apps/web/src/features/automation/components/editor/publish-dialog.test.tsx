// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type {
  ProcessType,
  WorkflowDetail,
  WorkflowDraftDocument,
  WorkflowProblem,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { useProcessTypes } = vi.hoisted(() => ({ useProcessTypes: vi.fn() }));

vi.mock('../../api/automation-api.js', () => ({ useProcessTypes }));
vi.mock('../../model/use-layout-autosave.js', () => ({
  flushLayoutAutosave: vi.fn(async () => undefined),
}));

import { PublishDialog } from './publish-dialog.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const STAGE_REMOVED = '00000000-0000-4000-8000-000000000002';
const STAGE_KEPT = '00000000-0000-4000-8000-000000000003';
const TYPE_ARCHIVED = '00000000-0000-4000-8000-000000000004';

const stage = (id: string, name: string, systemState: 'active' | 'closed' = 'active') => ({
  id,
  code: null,
  name,
  color: 'neutral' as const,
  systemState,
  outcome: systemState === 'closed' ? ('success' as const) : null,
  isInitial: false,
  sortOrder: 0,
});

const document = (stages: ReturnType<typeof stage>[]): WorkflowDraftDocument => ({
  stages,
  transitions: [],
});

const workflow = (typeIds: string[], counts: Record<string, number>): WorkflowDetail =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    typeIds,
    version: 1,
    publishedAt: null,
    publishedBy: null,
    document: { stages: [], transitions: [] },
    stageEntityCounts: counts,
  }) as WorkflowDetail;

const publish = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
  reset: vi.fn(),
};

function renderDialog(props: {
  baselineStages: ReturnType<typeof stage>[];
  docStages: ReturnType<typeof stage>[];
  types?: ProcessType[];
  typeIds?: string[];
  category?: 'task' | 'letter';
  counts?: Record<string, number>;
  problems?: WorkflowProblem[];
}) {
  useProcessTypes.mockReturnValue({ data: props.types ?? [] });
  render(
    <PublishDialog
      open
      onClose={() => undefined}
      workflow={workflow(props.typeIds ?? [], props.counts ?? {})}
      category={props.category ?? 'task'}
      baseline={document(props.baselineStages)}
      document={document(props.docStages)}
      baseVersion={1}
      problems={props.problems}
      publish={publish as never}
      onPublished={() => undefined}
      onConflictLoad={() => undefined}
    />,
  );
}

describe('PublishDialog: предпросмотр публикации (#430)', () => {
  it('«В полёте» считает задачи удаляемого статуса', () => {
    renderDialog({
      baselineStages: [stage(STAGE_REMOVED, 'Удаляемая'), stage(STAGE_KEPT, 'В работе')],
      docStages: [stage(STAGE_KEPT, 'В работе')],
      counts: { [STAGE_REMOVED]: 3, [STAGE_KEPT]: 2 },
    });

    expect(screen.getByText('5 задач')).toBeTruthy();
  });

  it('письмо без типов не называет задачи, архивный тип скрыт', () => {
    const archived = {
      id: TYPE_ARCHIVED,
      name: 'Архивный',
      category: 'letter',
      archivedAt: '2026-01-01T00:00:00.000Z',
    } as ProcessType;
    renderDialog({
      baselineStages: [],
      docStages: [],
      types: [archived],
      typeIds: [TYPE_ARCHIVED],
      category: 'letter',
    });

    expect(screen.getByText(ui.automation.publishAffectedNoTypes)).toBeTruthy();
    expect(screen.getByText(ui.automation.publishAffectedNoLetters)).toBeTruthy();
    expect(screen.queryByText('Архивный')).toBeNull();
  });

  it('показывает живые предупреждения проверки', () => {
    renderDialog({
      baselineStages: [],
      docStages: [],
      problems: [{ code: 'duplicate_stage_name', severity: 'warning' }] as WorkflowProblem[],
    });

    expect(screen.getByText(ui.automation.publishWarnings)).toBeTruthy();
  });
});
