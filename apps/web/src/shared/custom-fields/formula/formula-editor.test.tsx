// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CustomFieldDefinition, CustomFieldValues } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { demoCustomFieldDefinitions, demoFieldById } from '../../mocks/data/custom-fields.js';
import { fieldIds } from '../../mocks/data/field-ids.js';
import { demoNodeKinds } from '../../mocks/data/project-nodes.js';
import { processTypeIds } from '../../mocks/data/process-type-ids.js';
import { demoTasks } from '../../mocks/data/tasks.js';
import { registryHandlers } from '../mocks/custom-fields-registry-handlers.js';

import { formulaHandlers } from './formula-handlers.js';
import { resetFormulaCells } from './formula-state.js';
import { FormulaEditor } from './formula-editor.js';

/** Окно редактора формул (#632, §4c): формула типа в записи — просмотр с
 *  плашкой-пояснением; «Создать свою формулу» распломбирует строку (своя
 *  сильнее типовой, Р1), «Вернуться к формуле типа» откатывает черновик.
 *  Права нет (readOnly) — строка навсегда просмотр. */

const server = setupServer(
  ...formulaHandlers,
  ...registryHandlers,
  http.get('/api/v1/projects/node-kinds', () => HttpResponse.json(demoNodeKinds)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const komplektTask = demoTasks.find((task) => task.type.id === processTypeIds.komplekt)!;
const cipherDefinition = demoFieldById(fieldIds.komplektCipher)!;
const ownDefinitions = demoCustomFieldDefinitions.filter((definition: CustomFieldDefinition) =>
  [fieldIds.komplektCipher, fieldIds.komplektNumber, fieldIds.marka].includes(definition.id),
);

const originals = new Map<string, CustomFieldValues>();

beforeEach(() => {
  resetFormulaCells();
  originals.set(komplektTask.id, komplektTask.customFields);
});

afterEach(() => {
  cleanup();
  const original = originals.get(komplektTask.id);
  if (original) komplektTask.customFields = original;
});

function mountEditor(options: { readOnly?: boolean; fieldId?: string } = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FormulaEditor
        open
        host={{ kind: 'task', id: komplektTask.id }}
        fieldId={options.fieldId ?? fieldIds.komplektCipher}
        definition={cipherDefinition}
        ownDefinitions={ownDefinitions}
        hostContext={{ parentId: null, projectId: '41000000-0000-4000-8000-000000000001' }}
        readOnly={options.readOnly ?? false}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

const saveButton = () =>
  screen.getByRole('button', { name: ui.formulas.editor.save }) as HTMLButtonElement;
const removeButton = () =>
  screen.getByRole('button', { name: ui.formulas.editor.remove }) as HTMLButtonElement;

describe('FormulaEditor: формула типа — просмотр с распломбировкой (#632, Р1)', () => {
  it('origin=type: плашка-пояснение, строка read-only, палитры нет, кнопки неактивны', async () => {
    mountEditor();

    await waitFor(() => expect(screen.getByText(ui.formulas.editor.typeReadonly)).toBeTruthy());
    // Кнопка «Создать свою формулу» есть, «Вернуться» — нет.
    expect(
      screen.getByRole('button', { name: ui.formulas.editor.typeOverrideCreate }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.formulas.editor.typeOverrideBack })).toBeNull();
    // Просмотр: строка нередактируема, палитра и функции спрятаны.
    expect(document.querySelector('[role="textbox"]')?.getAttribute('contenteditable')).toBe(
      'false',
    );
    expect(screen.queryByLabelText(ui.formulas.editor.searchSources)).toBeNull();
    expect(screen.queryByText(ui.formulas.editor.functions)).toBeNull();
    // Сохранить/убрать нельзя: убирать свою формулу не у чего.
    expect(saveButton().disabled).toBe(true);
    expect(removeButton().disabled).toBe(true);
  });

  it('«Создать свою формулу» распломбирует: черновик-подсказка, палитра, активное сохранение', async () => {
    mountEditor();
    await waitFor(() => expect(screen.getByText(ui.formulas.editor.typeReadonly)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.editor.typeOverrideCreate }));

    expect(screen.getByText(ui.formulas.editor.typeOverrideHint)).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.formulas.editor.typeOverrideBack })).toBeTruthy();
    // Строка редактируема, палитра источников и функции на месте.
    expect(document.querySelector('[role="textbox"]')?.getAttribute('contenteditable')).toBe(
      'true',
    );
    expect(screen.getByLabelText(ui.formulas.editor.searchSources)).toBeTruthy();
    // Копия типовой формулы уже в строке — сохранить можно.
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('«Вернуться к формуле типа» откатывает черновик и возвращает просмотр', async () => {
    mountEditor();
    await waitFor(() => expect(screen.getByText(ui.formulas.editor.typeReadonly)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.editor.typeOverrideCreate }));
    await waitFor(() => expect(screen.getByText(ui.formulas.editor.typeOverrideHint)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.editor.typeOverrideBack }));

    expect(screen.getByText(ui.formulas.editor.typeReadonly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.formulas.editor.typeOverrideBack })).toBeNull();
    expect(screen.queryByLabelText(ui.formulas.editor.searchSources)).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it('readOnly прячет «Создать свою формулу»: зрителю нечего распломбировать', async () => {
    mountEditor({ readOnly: true });

    await waitFor(() => expect(screen.getByText(ui.formulas.editor.typeReadonly)).toBeTruthy());
    expect(
      screen.queryByRole('button', { name: ui.formulas.editor.typeOverrideCreate }),
    ).toBeNull();
    expect(document.querySelector('[role="textbox"]')?.getAttribute('contenteditable')).toBe(
      'false',
    );
  });
});

describe('FormulaEditor: своя формула и ошибки загрузки (#632, §4c)', () => {
  it('origin=own: плашки типа нет, палитра сразу доступна, «Убрать формулу» активна', async () => {
    // Свою формулу кладём в мок-мир напрямую, до открытия редактора.
    await fetch(
      `/api/v1/tasks/${komplektTask.id}/custom-fields/${fieldIds.komplektCipher}/formula`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ast: { kind: 'literal', value: 'КЖ-1' } }),
      },
    );

    mountEditor();

    // Ячейка загрузилась: своя формула в строке — сохранить можно.
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.queryByText(ui.formulas.editor.typeReadonly)).toBeNull();
    expect(
      screen.queryByRole('button', { name: ui.formulas.editor.typeOverrideCreate }),
    ).toBeNull();
    expect(screen.getByLabelText(ui.formulas.editor.searchSources)).toBeTruthy();
    expect(removeButton().disabled).toBe(false);
  });

  it('ячейка без формулы: строка пустая, сохранить нельзя, убрать нельзя', async () => {
    mountEditor({ fieldId: fieldIds.komplektNumber });

    await waitFor(() => expect(document.querySelector('[role="textbox"]')?.textContent).toBe(''));
    expect(screen.queryByText(ui.formulas.editor.typeReadonly)).toBeNull();
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(removeButton().disabled).toBe(true);
  });

  it('сбой загрузки ячейки: сообщение и «Повторить», без строки формулы', async () => {
    server.use(
      http.get(
        `/api/v1/tasks/${komplektTask.id}/custom-fields/${fieldIds.komplektCipher}/formula`,
        () => HttpResponse.json({ code: 'BOOM', message: 'x' }, { status: 500 }),
      ),
    );
    mountEditor();

    await waitFor(() => expect(screen.getByText(ui.formulas.editor.loadError)).toBeTruthy());
    expect(screen.getByRole('button', { name: ui.formulas.editor.retry })).toBeTruthy();
    expect(document.querySelector('[role="textbox"]')).toBeNull();
  });

  it('«Отмена» закрывает окно', async () => {
    const { onClose } = mountEditor();
    await waitFor(() => expect(screen.getByText(ui.formulas.editor.typeReadonly)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.editor.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('своя поверх типовой: «Сохранить формулу» пишет PUT и закрывает окно', async () => {
    const { onClose } = mountEditor();
    await waitFor(() => expect(screen.getByText(ui.formulas.editor.typeReadonly)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.editor.typeOverrideCreate }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Ячейка стала своей: значение материализовано мок-сервером.
    await waitFor(() =>
      expect(typeof komplektTask.customFields[fieldIds.komplektCipher]).toBe('string'),
    );
  });

  it('своя формула: «Убрать формулу» спрашивает подтверждение и снимает', async () => {
    await fetch(
      `/api/v1/tasks/${komplektTask.id}/custom-fields/${fieldIds.komplektCipher}/formula`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ast: { kind: 'literal', value: 'КЖ-1' } }),
      },
    );
    const { onClose } = mountEditor();
    await waitFor(() => expect(removeButton().disabled).toBe(false));

    fireEvent.click(removeButton());
    // Подтверждение объясняет последствие (#632, Р5), отменяемое.
    expect(screen.getByText(ui.formulas.cell.removeTitle)).toBeTruthy();
    expect(screen.getByText(ui.formulas.cell.removeHint)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.cell.removeConfirm }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Снятие очищает значение (#660) — ячейка возвращается к формуле типа.
    await waitFor(() => expect(komplektTask.customFields[fieldIds.komplektCipher]).toBeUndefined());
  });
});
