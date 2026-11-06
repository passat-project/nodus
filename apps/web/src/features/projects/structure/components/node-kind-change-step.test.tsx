// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind, ProjectNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';

const { KIND_ID, MARKA_ID, MARK_OV } = vi.hoisted(() => ({
  KIND_ID: '33333333-3333-4333-8333-333333333307',
  MARKA_ID: '35560000-0000-4000-8000-000000000001',
  MARK_OV: 'ОВ — Отопление, вентиляция и кондиционирование воздуха',
}));

function definition(
  id: string,
  type: CustomFieldDefinition['type'],
  name: string,
): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type,
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [KIND_ID] },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

vi.mock('../../../../shared/dictionaries/queries.js', () => ({
  useDictionaryItems: () => ({
    data: [{ id: 'mark-ov', name: MARK_OV, isActive: true }],
  }),
}));

import { NodeKindChangeStep } from './node-kind-change-step.js';

/** Новый вид «Комплект»: и «Код», и «Марка» обязательны (#556 В1). */
const KOMPLEKT: NodeKind = {
  id: KIND_ID,
  name: 'Комплект',
  icon: 'fileText',
  color: 'blue',
  archivedAt: null,
  form: {
    fields: [
      { fieldId: SYSTEM_FIELD_IDS.nodeCode, state: 'required' },
      { fieldId: MARKA_ID, state: 'required' },
    ],
  },
  capabilities: [],
};

const DEFINITIONS: CustomFieldDefinition[] = [
  definition(SYSTEM_FIELD_IDS.nodeCode, 'text', 'Код'),
  {
    ...definition(MARKA_ID, 'enum', 'Марка'),
    ...{ dictionary: { id: 'd1', code: 'set-mark', name: 'Марки', isSystem: false } },
  },
];

const ROLLUP = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
} as const;

function nodeOf(customFields: ProjectNode['customFields']): ProjectNode {
  return {
    id: '43000000-0000-4000-8000-000000000002',
    parentId: null,
    kindId: '33333333-3333-4333-8333-333333333301',
    name: 'Архитектурные решения',
    code: null,
    customFields,
    rollup: ROLLUP,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('NodeKindChangeStep: обязательные атрибуты нового вида (#556, Р6)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('недостающие обязательные собираются здесь, «Применить» ждёт заполнения', async () => {
    const onApply = vi.fn();
    render(
      <NodeKindChangeStep
        kind={KOMPLEKT}
        definitions={DEFINITIONS}
        node={nodeOf({})}
        refs={[]}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText(ui.structure.kindChangeFill.replace('{name}', 'Комплект')),
    ).toBeTruthy();
    const apply = screen.getByRole('button', { name: ui.structure.kindChangeApply });
    expect(apply).toHaveProperty('disabled', true);

    // «Код» — текстовый слот (Enter фиксирует), «Марка» — элемент справочника.
    fireEvent.change(screen.getByLabelText('Код'), { target: { value: 'ОВ1.1' } });
    fireEvent.keyDown(screen.getByLabelText('Код'), { key: 'Enter' });
    expect(apply).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Марка' }));
    fireEvent.click(screen.getByRole('button', { name: MARK_OV }));

    await waitFor(() => expect(apply).toHaveProperty('disabled', false));
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledWith({
      customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'ОВ1.1', [MARKA_ID]: 'mark-ov' },
    });
  });

  it('уже заполненное у папки не спрашивается', async () => {
    render(
      <NodeKindChangeStep
        kind={KOMPLEKT}
        definitions={DEFINITIONS}
        node={nodeOf({ [SYSTEM_FIELD_IDS.nodeCode]: 'АР' })}
        refs={[]}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Код')).toBeNull();
    expect(screen.getByRole('button', { name: 'Марка' })).toBeTruthy();
  });

  it('вид без обязательных применяется сразу, отмена возвращает прежний вид', () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const freeKind: NodeKind = { ...KOMPLEKT, form: { fields: [] } };
    render(
      <NodeKindChangeStep
        kind={freeKind}
        definitions={DEFINITIONS}
        node={nodeOf({})}
        refs={[]}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );

    const apply = screen.getByRole('button', { name: ui.structure.kindChangeApply });
    expect(apply).toHaveProperty('disabled', false);
    fireEvent.click(apply);
    // Значений не вводили — ключ customFields не едет.
    expect(onApply).toHaveBeenCalledWith({});

    fireEvent.click(screen.getByRole('button', { name: ui.structure.kindChangeCancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
