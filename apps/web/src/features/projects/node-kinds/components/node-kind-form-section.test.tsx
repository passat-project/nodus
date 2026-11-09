// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, NodeKindForm } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const b = ui.forms.builder;
const FIELD_ID = 'c0000000-0000-4000-8000-0000000000e1';
const KIND_ID = '70000000-0000-4000-8000-000000000001';

const fixtures = vi.hoisted(() => ({
  definitions: [
    {
      id: 'c0000000-0000-4000-8000-0000000000e1',
      number: 1,
      type: 'text',
      name: 'Шифр',
      hint: null,
      settings: {},
      dictionary: null,
      defaultValue: null,
      defaultRefs: [],
      reportIndexed: false,
      isCompany: false,
      companyValue: null,
      bindings: {
        processTypeIds: [],
        projectTypeIds: [],
        nodeKindIds: ['70000000-0000-4000-8000-000000000001'],
      },
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}));

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: fixtures.definitions }),
}));

import { NodeKindFormSection } from './node-kind-form-section.js';

afterEach(cleanup);

const KIND = {
  id: KIND_ID,
  name: 'Договор',
  form: {
    fields: [
      { fieldId: FIELD_ID, state: 'required' },
      { kind: 'heading', id: 'dhead001', text: 'Реквизиты' },
    ],
  },
} as unknown as NodeKind;

describe('раздел «При создании папки»: вход в общий редактор (#496)', () => {
  it('сводка окна и «Создать атрибут» в лотке редактора', () => {
    const onCreate = vi.fn();
    render(
      <NodeKindFormSection
        kind={KIND}
        canSetup
        canCreateField
        renderCreateField={onCreate}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: new RegExp(`${b.edit}.*Шифр`) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.edit) }));
    expect(screen.getByText(`${b.titles.folder} · Договор`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: b.createField }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ onClose: expect.any(Function) }),
    );
  });

  it('«Готово» сохраняет состав окна папки', () => {
    const onSave = vi.fn();
    render(<NodeKindFormSection kind={KIND} canSetup canCreateField={false} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.edit) }));
    fireEvent.click(screen.getByRole('button', { name: `${b.remove}: ${b.decor.heading}` }));
    fireEvent.click(screen.getByRole('button', { name: b.done }));

    expect(onSave).toHaveBeenCalledWith({
      fields: [{ fieldId: FIELD_ID, state: 'required', label: null }],
    } satisfies NodeKindForm);
  });

  it('без права настройки — просмотр, без «Готово» и создания атрибута', () => {
    render(
      <NodeKindFormSection
        kind={KIND}
        canSetup={false}
        canCreateField
        renderCreateField={() => <div>форма атрибута</div>}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: new RegExp(b.view) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.view) }));
    expect(screen.queryByRole('button', { name: b.done })).toBeNull();
    expect(screen.queryByRole('button', { name: b.createField })).toBeNull();
  });

  it('пустое окно папки — «атрибуты не выбраны»', () => {
    render(
      <NodeKindFormSection
        kind={{ ...KIND, form: { fields: [] } } as unknown as NodeKind}
        canSetup
        canCreateField={false}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText(ui.nodeKinds.form.empty)).toBeTruthy();
  });
});
