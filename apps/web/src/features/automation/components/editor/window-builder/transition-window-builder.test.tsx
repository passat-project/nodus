// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessCategory } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

/** Редактор окна кнопки (#496): настройки поля и блока — подпись, подсказка,
 *  высота, ширина, замок, формула; гейты блоков обратно в условия. */

import {
  CF_LONG,
  CF_MISSING,
  TYPE_ID,
  transitionWindow,
} from './transition-window-test-fixtures.js';

const b = ui.forms.builder;
const l = ui.forms.locks;
const w = ui.automation.window;

const store = vi.hoisted(() => ({ patchTransition: vi.fn() }));

vi.mock('../../../../../shared/custom-fields/queries.js', async () => {
  const { TEST_DEFINITIONS } = await import('./transition-window-test-fixtures.js');
  return { useCustomFieldDefinitions: () => ({ data: TEST_DEFINITIONS }) };
});
vi.mock('../../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => true,
}));
vi.mock('../../../model/route-doc-store.js', () => {
  const api = (selector: (value: typeof store) => unknown) => selector(store);
  api.getState = () => store;
  return { useRouteDocStore: api };
});

import { TransitionWindowBuilder } from './transition-window-builder.js';

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  store.patchTransition.mockClear();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function renderBuilder(category: ProcessCategory = 'task') {
  render(
    <QueryClientProvider client={queryClient}>
      <TransitionWindowBuilder
        open
        transition={transitionWindow()}
        scope="task"
        typeId={TYPE_ID}
        category={category}
        readOnly={false}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function openSettings(label: string): HTMLElement {
  const item = screen.getByText(label).closest('.group\\/item') as HTMLElement;
  fireEvent.click(within(item).getAllByRole('button', { name: b.settings })[0]!);
  return item;
}

function done() {
  fireEvent.click(screen.getByRole('button', { name: b.done }));
  expect(store.patchTransition).toHaveBeenCalledTimes(1);
  const patch = store.patchTransition.mock.calls[0]![1] as {
    form: ReturnType<typeof transitionWindow>['form'];
    rules: ReturnType<typeof transitionWindow>['rules'];
  };
  return patch;
}

describe('редактор окна кнопки: настройки', () => {
  it('поле: подпись, подсказка, высота, ширина, замок и «убрать»', () => {
    renderBuilder();

    const item = openSettings('Что сделано');
    const label = screen.getByLabelText(b.label) as HTMLInputElement;
    expect(label.value).toBe('Что сделано');
    fireEvent.change(label, { target: { value: '  Итог работ ' } });
    fireEvent.change(screen.getByLabelText(b.hint), { target: { value: 'Коротко по сути' } });
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(b.heightHints.large) }));
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(l.ownersHint) }));
    fireEvent.click(within(item).getByRole('button', { name: b.widthFull }));
    expect(screen.getByRole('button', { name: ui.formulas.typeFormula.set })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: b.remove }));

    const { form } = done();
    expect(form.sections.find((section) => section.kind === 'fields')).toMatchObject({
      fields: ['deadline', CF_LONG, CF_MISSING],
    });
    expect(form.locks).toEqual([{ key: 'plannedMinutes', editors: 'owners' }]);
  });

  it('атрибут: настройки из определения; удалённый — только «убрать»', () => {
    renderBuilder();

    openSettings('Комментарий наладчика');
    expect((screen.getByLabelText(b.label) as HTMLInputElement).placeholder).toBe(
      'Комментарий наладчика',
    );
    expect(screen.getByRole('radio', { name: new RegExp(b.heightHints.large) })).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.formulas.typeFormula.set })).toBeTruthy();
  });

  it('атрибут, которого больше нет: подсказка и удаление из окна', () => {
    renderBuilder();

    openSettings(b.unknownField);
    expect(screen.getByText(b.unknownFieldHint)).toBeTruthy();
    expect(screen.queryByLabelText(b.label)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: b.remove }));

    const { form } = done();
    expect(form.sections.find((section) => section.kind === 'fields')).toMatchObject({
      fields: ['deadline', { key: 'description', label: 'Что сделано', width: 'half' }, CF_LONG],
    });
  });

  it('блок трудозатрат: режим и «Обязательно» → условие «Есть трудозатраты» снимается', () => {
    renderBuilder();

    openSettings(w.sections.time);
    expect(screen.getByText(w.mode)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: w.modeIfEmptyShort }));
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(w.required) }));

    const { form, rules } = done();
    expect(form.sections).toContainEqual({ kind: 'time', mode: 'if_empty' });
    expect(rules.validators).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'time_logged' })]),
    );
  });

  it('блок итога: «Обязательно» → условие «Есть итог»', () => {
    renderBuilder();

    openSettings(w.sections.result);
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(w.required) }));

    const { rules } = done();
    expect(rules.validators).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'result_present' })]),
    );
  });

  it('блок файлов итога: минимум файлов → условие «Приложены файлы итога»', () => {
    renderBuilder();

    openSettings('Акты');
    fireEvent.change(screen.getByLabelText(w.minFiles), { target: { value: '2' } });

    const { form, rules } = done();
    expect(form.sections).toContainEqual({ kind: 'result_files', label: 'Акты' });
    expect(rules.validators).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'result_files', min: 2 })]),
    );
  });

  it('блок причины: «Обязательно» правит раздел, а не условие', () => {
    renderBuilder();

    openSettings('Причина');
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(w.required) }));

    const { form, rules } = done();
    expect(form.sections).toContainEqual({ kind: 'comment', label: 'Причина', required: false });
    expect(rules.validators).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fields_required' })]),
    );
  });

  it('«Закрепить также»: строка вне окна и снятие замка', () => {
    renderBuilder();

    expect(screen.getByText(l.alsoHint)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: l.removeLock }));

    const { form } = done();
    expect(form.locks).toEqual([{ key: 'description', editors: 'none' }]);
  });
});
