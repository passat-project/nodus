// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CustomFieldsBlock } from './custom-fields-block.js';

/** Блок «Атрибуты» карточки (#431/#631): показываются только атрибуты,
 *  привязанные к типу/виду сущности (Р3); нет атрибутов — блока нет;
 *  загрузка — скелеты; ошибка — повтор. */
vi.mock('./queries.js', () => ({
  useCustomFieldDefinitions: vi.fn(),
}));

const { useCustomFieldDefinitions } = await import('./queries.js');
const queryMock = vi.mocked(useCustomFieldDefinitions);

const TYPE_TASK = '00000000-0000-4000-8000-0000000000a1';

function definition(id: string, extra: Partial<CustomFieldDefinition> = {}) {
  return {
    id,
    number: 1,
    type: 'text',
    name: `Поле ${id}`,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [TYPE_TASK], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  } satisfies CustomFieldDefinition;
}

const BOUND = definition('57000000-0000-4000-8000-000000000001');
const OTHER_TYPE = definition('57000000-0000-4000-8000-000000000002', {
  bindings: {
    processTypeIds: ['00000000-0000-4000-8000-0000000000a9'],
    projectTypeIds: [],
    nodeKindIds: [],
  },
});
const WITH_HINT = definition('57000000-0000-4000-8000-000000000003', {
  hint: 'Номер накладной поставщика',
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function block(props: Partial<Parameters<typeof CustomFieldsBlock>[0]> = {}) {
  return render(
    <CustomFieldsBlock
      module="task"
      targetId={TYPE_TASK}
      values={{}}
      refs={[]}
      canEdit={false}
      onChange={() => {}}
      {...props}
    />,
  );
}

describe('CustomFieldsBlock', () => {
  it('загрузка — скелеты без строк', () => {
    queryMock.mockReturnValue({ isLoading: true } as never);
    const { container } = block();
    expect(screen.getByText(ui.customFields.block.title)).toBeTruthy();
    // Две строки-скелета вместо значений.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(2);
  });

  it('ошибка — строка с повтором', () => {
    const refetch = vi.fn();
    queryMock.mockReturnValue({ isLoading: false, isError: true, refetch } as never);
    block();

    expect(screen.getByText(ui.customFields.block.loadError)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.customFields.block.retry }));
    expect(refetch).toHaveBeenCalled();
  });

  it('нет привязанных к типу — блока нет', () => {
    queryMock.mockReturnValue({ isLoading: false, data: [OTHER_TYPE] } as never);
    const { container } = block();
    expect(container.querySelector('section')).toBeNull();
  });

  it('привязанные атрибуты — строки с именем, подсказкой и счётчиком', () => {
    queryMock.mockReturnValue({ isLoading: false, data: [BOUND, OTHER_TYPE, WITH_HINT] } as never);
    block({ canEdit: true, values: { [BOUND.id]: '№ 5' } });

    expect(screen.getByText(`${BOUND.name}`)).toBeTruthy();
    expect(screen.getByText(WITH_HINT.name)).toBeTruthy();
    expect(screen.queryByText(OTHER_TYPE.name)).toBeNull();
    // Подсказка — для скринридера.
    expect(screen.getByText(WITH_HINT.hint!)).toBeTruthy();
    // Значение показывается (без правки — строка значения).
    expect(screen.getByText('№ 5')).toBeTruthy();
  });
});
