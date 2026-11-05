// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS, ui } from '@nodus/contracts';

const { createMutate, batchMutate, KIND_ID, MARKA_ID, LONG_MARK } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  batchMutate: vi.fn(),
  KIND_ID: '33333333-3333-4333-8333-333333333307',
  MARKA_ID: '35560000-0000-4000-8000-000000000001',
  LONG_MARK: 'АТД — Автоматика и телемеханика движения поездов (СЦБ)',
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

function definition(
  id: string,
  type: CustomFieldDefinition['type'],
  name: string,
  extra: Partial<CustomFieldDefinition> = {},
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
    ...extra,
  };
}

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      // Код папки — обычный атрибут реестра (SYSTEM_FIELD_IDS.nodeCode, #631).
      definition(SYSTEM_FIELD_IDS.nodeCode, 'text', 'Код'),
      definition(MARKA_ID, 'enum', 'Марка', {
        settings: { dictionaryId: '35560000-0000-4000-8000-0000000000a1' },
        dictionary: {
          id: '35560000-0000-4000-8000-0000000000a1',
          code: 'set-mark',
          name: 'Марки',
          isSystem: false,
        },
      }),
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

describe('NodeCreateDialog: длинная марка не ломает форму (#615)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('код уходит атрибутом «Код», длинная марка доступна в title', async () => {
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
    // «Код» — TextEditor атрибута: фиксируется Enter (в старом тесте поле
    // было контролем окна и коммитилось каждым символом).
    fireEvent.change(screen.getByLabelText('Код'), {
      target: { value: 'ОВ1.1' },
    });
    fireEvent.keyDown(screen.getByLabelText('Код'), { key: 'Enter' });

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
    // Код — значение атрибута SYSTEM_FIELD_IDS.nodeCode, отдельного поля
    // `code` в мутации больше нет (ревизия #631).
    expect(createMutate).toHaveBeenCalledWith(
      {
        parentId: null,
        kindId: KOMPLEKT.id,
        name: 'Корпус 1',
        customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'ОВ1.1', [MARKA_ID]: 'mark-long' },
      },
      expect.anything(),
    );
  });
});
