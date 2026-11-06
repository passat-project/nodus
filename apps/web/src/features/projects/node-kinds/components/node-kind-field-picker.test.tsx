// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';

const { KIND_ID, MARKA_ID, AREA_ID } = vi.hoisted(() => ({
  KIND_ID: '33333333-3333-4333-8333-333333333307',
  MARKA_ID: '35560000-0000-4000-8000-000000000001',
  AREA_ID: 'c0000000-0000-4000-8000-0000000000f2',
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

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      definition(SYSTEM_FIELD_IDS.nodeCode, 'text', 'Код'),
      definition(MARKA_ID, 'enum', 'Марка'),
      definition(AREA_ID, 'number', 'Площадь, м²'),
    ],
  }),
}));

import { NodeKindFieldPicker } from './node-kind-field-picker.js';

/** Вид «Комплект»: «Код» и «Марка» уже в форме, «Площадь» — нет. */
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

describe('NodeKindFieldPicker: атрибуты, привязанные к виду (#556, #631)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('предлагает только непоставленные атрибуты вида, выбор закрывает поповер', () => {
    const onPick = vi.fn();
    render(
      <NodeKindFieldPicker
        kind={KOMPLEKT}
        disabled={false}
        canCreateField={false}
        onPick={onPick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));

    // Уже стоящие в форме «Код»/«Марка» не предлагаются.
    expect(screen.queryByRole('option', { name: 'Код' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Марка' })).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /Площадь/ }));
    expect(onPick).toHaveBeenCalledWith(AREA_ID);

    // Выбор закрыл поповер — повторный клик по триггеру открывает заново.
    expect(screen.queryByRole('option', { name: /Площадь/ })).toBeNull();
  });

  it('все привязанные атрибуты уже в форме — честная пустота', () => {
    const fullKind: NodeKind = {
      ...KOMPLEKT,
      form: {
        fields: [...KOMPLEKT.form.fields, { fieldId: AREA_ID, state: 'optional' }],
      },
    };
    render(
      <NodeKindFieldPicker
        kind={fullKind}
        disabled={false}
        canCreateField={false}
        onPick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));
    expect(screen.getByText(ui.nodeKinds.form.pickerEmpty)).toBeTruthy();
  });

  it('«Создать атрибут…» — только с правом custom_field.manage', () => {
    const onCreateField = vi.fn();
    const { rerender } = render(
      <NodeKindFieldPicker
        kind={KOMPLEKT}
        disabled={false}
        canCreateField={false}
        onPick={vi.fn()}
        onCreateField={onCreateField}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));
    expect(screen.queryByText(ui.nodeKinds.form.createField)).toBeNull();
    // Закрываем поповер: следующий триггер должен его открыть, а не закрыть.
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));

    rerender(
      <NodeKindFieldPicker
        kind={KOMPLEKT}
        disabled={false}
        canCreateField
        onPick={vi.fn()}
        onCreateField={onCreateField}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));
    fireEvent.click(screen.getByText(ui.nodeKinds.form.createField));
    expect(onCreateField).toHaveBeenCalledTimes(1);
    // Диалог создания открывается, поповер закрывается.
    expect(screen.queryByText(ui.nodeKinds.form.createField)).toBeNull();
  });

  it('disabled глушит триггер', () => {
    render(
      <NodeKindFieldPicker kind={KOMPLEKT} disabled canCreateField={false} onPick={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: ui.nodeKinds.form.addField })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
