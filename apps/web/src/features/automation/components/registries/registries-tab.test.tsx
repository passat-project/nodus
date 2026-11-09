// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

const r = ui.forms.registries;
const b = ui.forms.builder;

const fixtures = vi.hoisted(() => ({
  definitions: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].map(
    (id, index) => ({
      id,
      number: index + 1,
      type: index === 0 ? 'counterparty' : 'text',
      name: index === 0 ? 'Заказчик' : 'Комментарий',
      hint: null,
      settings: {},
      dictionary: null,
      defaultValue: null,
      defaultRefs: [],
      reportIndexed: false,
      isCompany: false,
      companyValue: null,
      bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
      sortOrder: index,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  ),
}));

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: fixtures.definitions }),
}));

import { RegistriesTab } from './registries-tab.js';

afterEach(cleanup);

describe('вкладка «Реестры»: заготовка окна строки (#496, #636)', () => {
  it('показывает демо-реестр и открывает окно строки общим редактором', () => {
    render(<RegistriesTab />);

    expect(screen.getByText(r.tab)).toBeTruthy();
    expect(screen.getByText(r.lead)).toBeTruthy();
    expect(screen.getByText(`${r.rows}: ${r.demoRows}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: r.editRow }));
    expect(screen.getByText(`${b.titles.registry} · ${r.demoName}`)).toBeTruthy();
    expect(screen.getByDisplayValue('Данные выдачи')).toBeTruthy();
    expect(screen.getByText('Заказчик')).toBeTruthy();
  });

  it('правка строки сохраняется до закрытия вкладки', () => {
    render(<RegistriesTab />);

    fireEvent.click(screen.getByRole('button', { name: r.editRow }));
    fireEvent.click(screen.getByRole('button', { name: `${b.remove}: ${b.decor.heading}` }));
    fireEvent.click(screen.getByRole('button', { name: b.done }));

    fireEvent.click(screen.getByRole('button', { name: r.editRow }));
    expect(screen.queryByDisplayValue('Данные выдачи')).toBeNull();
    expect(screen.getByText('Заказчик')).toBeTruthy();
  });
});
