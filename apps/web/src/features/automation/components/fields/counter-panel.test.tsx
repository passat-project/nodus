// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldDraft } from '../../lib/field-draft.js';

const hooks = vi.hoisted(() => ({
  counts: {
    data: {
      items: [
        {
          containers: [],
          periodKey: '',
          lastValue: 2,
          lastDisplay: '2',
          nextValue: 3,
          nextDisplay: '3',
        },
      ],
      totals: { counts: 1, issued: 2 },
    },
    isLoading: false,
  },
  coverage: {
    data: {
      total: 2,
      inside: 1,
      outside: [{ kind: 'task', id: 't-1', name: 'Задача', reason: 'no_folder' }],
      hiddenOutside: 0,
    },
  },
  backfill: {
    data: {
      total: 2,
      groups: [
        {
          containers: [],
          count: 2,
          firstDisplay: '1',
          lastDisplay: '2',
        },
      ],
      blocked: [],
      blockedTotal: 0,
      emptyParts: 0,
    },
  },
}));

vi.mock('../../api/numbering-api.js', () => ({
  useNumberCounts: () => hooks.counts,
  useSetNumberNext: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNumberCoverage: () => hooks.coverage,
  useNumberPreview: () => ({ mutate: vi.fn(), data: null, isPending: false }),
  useNumberBackfillPreview: () => hooks.backfill,
  useNumberBackfill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: () => ({ data: [] }),
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: () => ({ data: [] }),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: () => ({ data: [] }),
}));
vi.mock('../../../../shared/custom-fields/value-editor.js', () => ({
  CustomFieldEditor: () => <span>ref</span>,
}));
vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
  useNumberHostAssignments: () => ({ data: { items: [] } }),
}));

import { CounterPanel } from './counter-panel.js';
import { CounterCounts } from './counter-counts.js';
import { CounterCoverage } from './counter-coverage.js';
import { CounterBackfillButton } from './counter-backfill-dialog.js';
import { CounterCheck } from './counter-check.js';

afterEach(cleanup);

const KIND = '11111111-1111-4111-8111-111111111111';
const names = {
  nodeKind: (id: string) => (id === KIND ? 'Комплект' : undefined),
  field: (number: number) => (number === 7 ? 'Инв. №' : undefined),
};
const rule = {
  containers: [{ kind: 'folder' as const, nodeKindId: KIND }],
  period: 'year' as const,
  template: [
    { kind: 'counter' as const },
    { kind: 'literal' as const, text: '-' },
    { kind: 'year' as const, digits: 2 as const },
  ],
  startValue: 1,
  step: 1,
};
const draft = {
  name: 'Изм.',
  numbering: rule,
  numberingNext: null,
  numberingOnCreate: [],
  bindings: { processTypeIds: ['type-1'], projectTypeIds: [], nodeKindIds: [] },
} as unknown as FieldDraft;

describe('счётчик: панель, счета, охват, выдача существующим (#630)', () => {
  it('CounterPanel: сводка и окно правила', () => {
    const { container } = render(
      <CounterPanel
        draft={draft}
        definition={null}
        preview={null}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Настроить номер/i }));
    expect(screen.getByText(/Вести счёт отдельно/i)).toBeTruthy();
  });

  it('CounterCounts: счета и переход к правке следующего номера', () => {
    render(<CounterCounts definitionId="def-1" rule={rule} disabled={false} />);
    expect(screen.getByText(/Текущие счета/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Изменить/i }));
    expect(screen.getByLabelText(/Следующий номер/i)).toBeTruthy();
  });

  it('CounterCoverage: часть записей вне счёта', () => {
    const { container } = render(
      <CounterCoverage rule={rule} participantTypeIds={['type-1']} names={names} />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('CounterBackfillButton: окно предпросмотра выдачи существующим', () => {
    render(<CounterBackfillButton definitionId="def-1" count={2} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Выдать номера существующим/i }));
    expect(screen.getAllByText(/Выдать номера существующим/i).length).toBeGreaterThan(0);
  });
});

it('CounterCheck: проверка на записи рендерится', () => {
  const { container } = render(
    <CounterCheck
      rule={rule}
      definitionId="def-1"
      participantTypeIds={['type-1']}
      kinds={['task']}
      names={names}
    />,
  );
  expect(container.firstChild).not.toBeNull();
});
