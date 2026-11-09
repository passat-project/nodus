// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessCategory, WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

/** Редактор окна кнопки (#496): состав окна как у сотрудника, просмотр,
 *  окно письма, лоток и «+», перестановка элементов. */

import { TYPE_ID, transitionWindow } from './transition-window-test-fixtures.js';

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

function renderBuilder({
  readOnly = false,
  category = 'task' as ProcessCategory,
  draft = transitionWindow(),
} = {}) {
  render(
    <QueryClientProvider client={queryClient}>
      <TransitionWindowBuilder
        open
        transition={draft}
        scope="task"
        typeId={TYPE_ID}
        category={category}
        readOnly={readOnly}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function done() {
  fireEvent.click(screen.getByRole('button', { name: b.done }));
  expect(store.patchTransition).toHaveBeenCalledTimes(1);
  return store.patchTransition.mock.calls[0]![1] as {
    form: WorkflowDraftTransition['form'];
    rules: WorkflowDraftTransition['rules'];
  };
}

describe('редактор окна кнопки: вид и состав', () => {
  it('поля — как у сотрудника, блоки настоящие, недостающее условие — снизу', () => {
    renderBuilder();

    expect(screen.getByText(`${b.titles.transition} «Выдать в печать»`)).toBeTruthy();
    expect(screen.getByText(b.lead)).toBeTruthy();
    expect(screen.getByText('Что сделано')).toBeTruthy();
    expect(screen.getByText('Комментарий наладчика')).toBeTruthy();
    expect(screen.getByText(b.unknownField)).toBeTruthy();
    expect(screen.queryByText('Чужой атрибут')).toBeNull();
    expect(screen.getByText(w.sections.time)).toBeTruthy();
    expect(screen.getByText(w.sections.result)).toBeTruthy();
    expect(screen.getByText('Акты')).toBeTruthy();
    expect(screen.getAllByText(w.sections.result_messages).length).toBeGreaterThan(0);
    expect(screen.getByText('Причина')).toBeTruthy();
    expect(screen.getByText(w.modeAlwaysHint)).toBeTruthy();
    expect(screen.getAllByText(ui.tasks.window.messagesLabel).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`${b.fromGate}.*Исполнитель`))).toBeTruthy();
  });

  it('только просмотр: без лотка и «Готово», замки только читаются', () => {
    renderBuilder({ readOnly: true });

    expect(screen.getByText(b.readOnly)).toBeTruthy();
    expect(screen.queryByText(b.tray)).toBeNull();
    expect(screen.getByText(l.also)).toBeTruthy();
    expect(screen.queryByRole('button', { name: l.removeLock })).toBeNull();
    expect(screen.queryByRole('button', { name: b.done })).toBeNull();
    expect(screen.getByRole('button', { name: b.close })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: b.dragHandle })).toHaveLength(0);
  });

  it('окно письма: «Регистрация» как блок и «Причина» из лотка', () => {
    renderBuilder({
      category: 'letter',
      draft: transitionWindow({
        rules: { conditions: [], validators: [], postFunctions: [] },
        form: {
          enabled: true,
          sections: [{ kind: 'fields', fields: ['description'] }, { kind: 'registration' }],
        },
      }),
    });

    expect(screen.getByText(w.sections.registration)).toBeTruthy();
    expect(screen.getByText(w.registrationHint)).toBeTruthy();
    expect(screen.queryByText(w.sections.time)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(w.sections.comment) }));
    const { form } = done();
    expect(form.sections).toContainEqual(
      expect.objectContaining({ kind: 'comment', required: true }),
    );
  });
});

describe('редактор окна кнопки: лоток и «+»', () => {
  it('лоток добавляет поле, «+» — оформление', () => {
    renderBuilder();

    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(b.systemLabels.plannedMinutes) }),
    );
    expect(screen.getAllByText(b.systemLabels.plannedMinutes).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: b.insert })[0]!);
    fireEvent.click(screen.getByRole('button', { name: b.decor.heading }));
    fireEvent.change(screen.getByPlaceholderText(b.headingPlaceholder), {
      target: { value: 'Что выдаём' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: b.insert })[0]!);
    fireEvent.click(screen.getByRole('button', { name: b.decor.gap }));

    const { form } = done();
    const fields = form.sections.find((section) => section.kind === 'fields');
    expect(fields?.kind === 'fields' ? fields.fields : []).toEqual(
      expect.arrayContaining([
        { kind: 'heading', id: expect.any(String), text: 'Что выдаём' },
        { kind: 'gap', id: expect.any(String) },
      ]),
    );
  });

  it('Alt+стрелка двигает элемент', () => {
    renderBuilder();

    const handles = screen.getAllByRole('button', { name: b.dragHandle });
    fireEvent.keyDown(handles[1]!, { key: 'ArrowUp', altKey: true });
    const { form } = done();
    const fields = form.sections.find((section) => section.kind === 'fields');
    expect(fields?.kind === 'fields' ? fields.fields.slice(0, 2) : []).toEqual([
      { key: 'description', label: 'Что сделано', width: 'half' },
      'deadline',
    ]);
  });
});
