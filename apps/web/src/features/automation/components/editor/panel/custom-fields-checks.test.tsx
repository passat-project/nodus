// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { customFieldKey, ui, type CustomFieldDefinition } from '@nodus/contracts';

import { CustomFieldChecks } from './custom-fields-checks.js';

/**
 * Панель «Атрибуты» кнопки маршрута (#646): удалённое определение уже не
 * приходит из реестра, но ключ `cf.<id>` остался в документе — публикация
 * блокируется `custom_field_unknown`. Строка «Атрибут удалён» должна быть
 * видима и снимаема, иначе починить маршрут из UI нельзя.
 */

const LIVE_ID = '00000000-0000-4000-8000-0000000000c1';
const GONE_ID = '00000000-0000-4000-8000-0000000000c2';

const state = vi.hoisted(() => ({ data: [] as CustomFieldDefinition[] }));

vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: state.data }),
}));

const definition = {
  id: LIVE_ID,
  number: 1,
  type: 'text',
  name: 'Марка',
  hint: null,
  settings: {},
  dictionary: null,
  defaultValue: null,
  defaultRefs: [],
  reportIndexed: false,
  isCompany: false,
  companyValue: null,
  companyRefs: [],
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
  sortOrder: 0,
  createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z',
} as unknown as CustomFieldDefinition;

function renderChecks(selected: string[], onToggle = vi.fn()) {
  render(
    <CustomFieldChecks
      scope="task"
      selected={selected}
      disabled={false}
      limit={10}
      onToggle={onToggle}
    />,
  );
  return onToggle;
}

afterEach(() => {
  cleanup();
  state.data = [];
});

describe('панель «Атрибуты»: удалённый атрибут (#646)', () => {
  it('живой атрибут — по имени, удалённый — строкой «Атрибут удалён»', () => {
    state.data = [definition];
    renderChecks([customFieldKey(LIVE_ID), customFieldKey(GONE_ID)]);
    expect(screen.getByText('Марка')).toBeTruthy();
    expect(screen.getByText(ui.automation.creation.unknownAttribute)).toBeTruthy();
  });

  it('удалённый атрибут снимается флажком (ключ уходит в onToggle)', () => {
    state.data = [definition];
    const onToggle = renderChecks([customFieldKey(GONE_ID)]);
    const row = screen.getByText(ui.automation.creation.unknownAttribute).closest('label');
    expect(row).toBeTruthy();
    const checkbox = row!.querySelector('button');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    expect(onToggle).toHaveBeenCalledWith(customFieldKey(GONE_ID));
  });

  it('когда живых атрибутов нет, но есть удалённый — группа не схлопывается в ссылку', () => {
    state.data = [];
    renderChecks([customFieldKey(GONE_ID)]);
    expect(screen.queryByText(ui.automation.window.customFieldsEmpty)).toBeNull();
    expect(screen.getByText(ui.automation.creation.unknownAttribute)).toBeTruthy();
  });
});
