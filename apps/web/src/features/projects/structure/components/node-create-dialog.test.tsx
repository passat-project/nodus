// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { createMutate, batchMutate, MARKA_ID, LONG_MARK } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  batchMutate: vi.fn(),
  MARKA_ID: '35560000-0000-4000-8000-000000000001',
  LONG_MARK: 'АТД — Автоматика и телемеханика движения поездов (СЦБ)',
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      {
        id: MARKA_ID,
        scope: 'node',
        type: 'enum',
        name: 'Марка',
        hint: null,
        settings: { dictionaryId: '35560000-0000-4000-8000-0000000000a1' },
        dictionary: {
          id: '35560000-0000-4000-8000-0000000000a1',
          code: 'set-mark',
          name: 'Марки',
          isSystem: false,
        },
        defaultValue: null,
        defaultRefs: [],
        reportIndexed: false,
        hidden: false,
        typeIds: [],
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }),
}));

vi.mock('../../../../shared/dictionaries/queries.js', () => ({
  useDictionaryItems: () => ({
    data: [{ id: 'mark-long', name: LONG_MARK, isActive: true }],
  }),
}));

vi.mock('../api/structure-api.js', () => ({
  useCreateNode: () => ({ mutate: createMutate, isPending: false }),
  useBatchCreateNodes: () => ({ mutate: batchMutate, isPending: false }),
}));

vi.mock('../../node-kinds/api/node-kinds-api.js', () => ({
  useRefreshNodeKinds: () => vi.fn(),
}));

import { NodeCreateDialog } from './node-create-dialog.js';

const KOMPLEKT: NodeKind = {
  id: '33333333-3333-4333-8333-333333333307',
  name: 'Комплект',
  icon: 'fileText',
  color: 'blue',
  archivedAt: null,
  form: { code: 'required', fields: [{ fieldId: MARKA_ID, state: 'required' }] },
  capabilities: [],
};

describe('NodeCreateDialog: длинная марка не ломает форму (#615)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('выбранная длинная марка уходит в создание, полное имя доступно в title', async () => {
    render(
      <NodeCreateDialog
        projectId="project"
        parent={null}
        kinds={[KOMPLEKT]}
        canSetup={false}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText(ui.structure.nodeName), {
      target: { value: 'Корпус 1' },
    });
    fireEvent.change(screen.getByLabelText(ui.structure.nodeCode, { exact: false }), {
      target: { value: 'ОВ1.1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Марка' }));
    fireEvent.click(await screen.findByRole('button', { name: LONG_MARK }));

    // Длинное имя не теряется: оно целиком живёт в title (подсказка при наведении).
    expect(screen.getByTitle(LONG_MARK)).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: ui.common.create })).toHaveProperty(
        'disabled',
        false,
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: null,
        kindId: KOMPLEKT.id,
        name: 'Корпус 1',
        code: 'ОВ1.1',
        customFields: { [MARKA_ID]: 'mark-long' },
      }),
      expect.anything(),
    );
  });
});
