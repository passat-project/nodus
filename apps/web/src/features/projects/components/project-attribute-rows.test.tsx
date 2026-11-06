// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, CustomFieldValues, ProjectType } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { fieldIds } from '../../../shared/mocks/data/field-ids.js';

const TYPE_ID = '41000000-0000-4000-8000-0000000000e1';
const OTHER_TYPE_ID = '41000000-0000-4000-8000-0000000000e2';
const CLIENT_ID = '70000000-0000-4000-8000-0000000000c1';

function definition(
  id: string,
  type: CustomFieldDefinition['type'],
  name: string,
  projectTypeIds: string[],
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
    bindings: { processTypeIds: [], projectTypeIds, nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const COMMENT_ID = 'c0000000-0000-4000-8000-0000000000f1';

vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      // «Шифр»/«Заказчик» — системные атрибуты, привязанные к типу (#631);
      // «Комментарий» — long_text; «№ накладной» привязан к ДРУГОМУ типу —
      // в форме этого типа его быть не должно.
      definition(fieldIds.projectCode, 'text', 'Шифр', [TYPE_ID]),
      definition(fieldIds.projectClient, 'counterparty', 'Заказчик', [TYPE_ID]),
      definition(COMMENT_ID, 'long_text', 'Комментарий', [TYPE_ID]),
      definition(fieldIds.invoiceNumber, 'text', '№ накладной', [OTHER_TYPE_ID]),
    ],
  }),
}));

vi.mock('../../../shared/counterparties/queries.js', () => ({
  useCounterpartyOptions: () => ({
    data: [
      {
        id: CLIENT_ID,
        shortName: 'АО «Галургия»',
        fullName: 'Акционерное общество «Галургия»',
        unp: '100123456',
        archivedAt: null,
      },
    ],
  }),
}));

import { ProjectAttributeRows } from './project-attribute-rows.js';

function typeOf(fields: { fieldId: string; state: string }[]): ProjectType {
  return {
    id: TYPE_ID,
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    kindIds: null,
    archivedAt: null,
    // Форма проходит zod-схему контракта: состояния слота — литералы.
    form: {
      fields: fields.map((slot) => ({
        fieldId: slot.fieldId,
        state: slot.state as 'hidden' | 'optional' | 'required',
      })),
    },
  };
}

describe('ProjectAttributeRows: слоты атрибутов формы типа (#631)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('обязательный слот — со звёздочкой, значение видно в редакторе', () => {
    const onChange = vi.fn();
    const values: CustomFieldValues = { [fieldIds.projectCode]: '22-01' };
    render(
      <ProjectAttributeRows
        type={typeOf([
          { fieldId: fieldIds.projectCode, state: 'required' },
          { fieldId: fieldIds.projectClient, state: 'optional' },
        ])}
        values={values}
        refs={[]}
        onChange={onChange}
      />,
    );

    const code = screen.getByLabelText('Шифр') as HTMLInputElement;
    expect(code.value).toBe('22-01');
    // Опциональный «Заказчик» рендерится триггером выбора контрагента.
    expect(screen.getByRole('button', { name: 'Заказчик' })).toBeTruthy();
    // Звёздочка обязательного слота — у метки «Шифр».
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('скрытые слоты и атрибуты чужого типа не спрашиваются', () => {
    render(
      <ProjectAttributeRows
        type={typeOf([
          { fieldId: fieldIds.projectCode, state: 'hidden' },
          { fieldId: fieldIds.projectClient, state: 'optional' },
        ])}
        values={{}}
        refs={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Шифр')).toBeNull();
    // Привязан к другому типу — в определениях этого типа его нет.
    expect(screen.queryByLabelText('№ накладной')).toBeNull();
    expect(screen.getByRole('button', { name: 'Заказчик' })).toBeTruthy();
  });

  it('ввод фиксируется Enter, очистка уходит null', () => {
    const onChange = vi.fn();
    render(
      <ProjectAttributeRows
        type={typeOf([{ fieldId: fieldIds.projectCode, state: 'required' }])}
        values={{ [fieldIds.projectCode]: '22-01' }}
        refs={[]}
        onChange={onChange}
      />,
    );

    const code = screen.getByLabelText('Шифр');
    fireEvent.change(code, { target: { value: 'ОВ1.1' } });
    fireEvent.keyDown(code, { key: 'Enter' });
    // Текстовый редактор коммитит без ссылок — третий аргумент undefined.
    expect(onChange).toHaveBeenCalledWith(fieldIds.projectCode, 'ОВ1.1', undefined);

    fireEvent.change(code, { target: { value: '' } });
    fireEvent.keyDown(code, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(fieldIds.projectCode, null, undefined);
  });

  it('«Заказчик»: выбор контрагента коммитит значение со ссылкой', () => {
    const onChange = vi.fn();
    render(
      <ProjectAttributeRows
        type={typeOf([{ fieldId: fieldIds.projectClient, state: 'optional' }])}
        values={{}}
        refs={[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Заказчик' }));
    fireEvent.click(screen.getByRole('button', { name: /Галургия/ }));

    expect(onChange).toHaveBeenCalledWith(SYSTEM_FIELD_IDS.projectClient, CLIENT_ID, [
      {
        kind: 'counterparty',
        id: CLIENT_ID,
        name: 'АО «Галургия»',
        avatarUrl: null,
        archived: false,
      },
    ]);
  });

  it('многострочный текст — редактор на всю ширину окна', () => {
    render(
      <ProjectAttributeRows
        type={typeOf([{ fieldId: COMMENT_ID, state: 'optional' }])}
        values={{}}
        refs={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Комментарий')).toBeTruthy();
  });

  it('без слотов не рендерит ничего', () => {
    const { container } = render(
      <ProjectAttributeRows type={null} values={{}} refs={[]} onChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
