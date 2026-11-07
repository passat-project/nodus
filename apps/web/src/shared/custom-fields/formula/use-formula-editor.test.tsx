// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { CustomFieldValues } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { fieldIds } from '../../mocks/data/field-ids.js';
import { demoNodeKinds } from '../../mocks/data/project-nodes.js';
import { processTypeIds } from '../../mocks/data/process-type-ids.js';
import { demoTasks } from '../../mocks/data/tasks.js';
import { registryHandlers } from '../mocks/custom-fields-registry-handlers.js';

import { formulaKeys, type FormulaHost } from './formula-api.js';
import { formulaHandlers } from './formula-handlers.js';
import { resetFormulaCells } from './formula-state.js';
import { useFormulaEditor } from './use-formula-editor.js';

/** Хук редактора формул (#632, §4c): загрузка AST в строку плашек, правка
 *  не затирается фоновым GET (dirtyRef), откат к формуле ячейки, палитра,
 *  автодополнение и превью с debounce. MSW-мир формул — живой. */

const server = setupServer(
  ...formulaHandlers,
  ...registryHandlers,
  http.get('/api/v1/projects/node-kinds', () => HttpResponse.json(demoNodeKinds)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const komplektTask = demoTasks.find((task) => task.type.id === processTypeIds.komplekt)!;
const host: FormulaHost = { kind: 'task', id: komplektTask.id };

const originals = new Map<string, CustomFieldValues>();

beforeEach(() => {
  vi.clearAllMocks();
  resetFormulaCells();
  originals.set(komplektTask.id, komplektTask.customFields);
});

afterEach(() => {
  cleanup();
  const original = originals.get(komplektTask.id);
  if (original) komplektTask.customFields = original;
});

/** Свои поля места хоста: шифр (само поле формулы), номер и марка. */
const ownDefinitions = demoCustomFieldDefinitions.filter((definition) =>
  [fieldIds.komplektCipher, fieldIds.komplektNumber, fieldIds.marka].includes(definition.id),
);

type Editor = ReturnType<typeof useFormulaEditor>;
let editor: Editor;
let queryClient: QueryClient;
let onClose: ReturnType<typeof vi.fn>;

/** Стенд: строка формулы как в окне (contenteditable + события хука). */
function mountEditor(fieldId: string) {
  onClose = vi.fn();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    editor = useFormulaEditor({
      open: true,
      host,
      fieldId,
      ownDefinitions,
      hostContext: { parentId: null, projectId: '41000000-0000-4000-8000-000000000001' },
      onClose,
    });
    return (
      <div
        ref={editor.setRootRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        onInput={editor.handleInput}
        onKeyDown={editor.handleKeyDown}
      />
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { line: () => document.querySelector('[role="textbox"]') as HTMLDivElement };
}

const chipTitles = (line: HTMLElement) =>
  [...line.querySelectorAll<HTMLElement>('[data-chip-id]')].map((chip) => chip.title);

/** Каретка в конец последнего текстового узла — как после реального
 *  набора (в отличие от вставки плашки, которая ставит каретку после
 *  узла на уровне корня). */
function caretInsideLastText(line: HTMLElement): void {
  const text = [...line.childNodes].reverse().find((node) => node.nodeType === Node.TEXT_NODE) as
    Text | undefined;
  if (!text) return;
  const range = document.createRange();
  range.setStart(text, text.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('useFormulaEditor: загрузка ячейки и строка плашек (#632, §4c)', () => {
  it('формула типа грузится в строку: плашки-атрибуты с источниками, разбор и превью', async () => {
    const { line } = mountEditor(fieldIds.komplektCipher);

    await waitFor(() => expect(editor.cell.data?.origin).toBe('type'));
    await waitFor(() =>
      expect(line().querySelectorAll('[data-chip-id]').length).toBeGreaterThan(0),
    );

    // Подписи плашек несут источник: проект, папка, свои поля.
    const titles = chipTitles(line());
    expect(titles).toContain(`${ui.formulas.chipPrefix.project} · Шифр`);
    expect(titles).toContain(`${ui.formulas.chipPrefix.folder} · № по ГП`);
    expect(editor.parse.ast).toBeTruthy();
    expect(editor.parse.error).toBeNull();
    expect(editor.empty).toBe(false);

    // Превью приходит после debounce: значение формулы типа посчитано.
    await waitFor(() => expect(editor.preview.value).not.toBeNull(), { timeout: 4000 });
    expect(editor.preview.error).toBeNull();
    expect(editor.issues).toEqual([]);
  });

  it('ячейка без формулы — пустая строка и признак empty', async () => {
    const { line } = mountEditor(fieldIds.komplektNumber);

    await waitFor(() => expect(editor.cell.data).toEqual({ ast: null, origin: null }));
    await waitFor(() => expect(editor.empty).toBe(true));
    expect(line().textContent).toBe('');

    await act(async () => {
      editor.insertText('2');
    });
    expect(editor.empty).toBe(false);
    expect(editor.parse.ast).toEqual({ kind: 'literal', value: 2 });
  });

  it('палитра своих полей исключает сам атрибут формулы (цикл), проектные источники на месте', async () => {
    mountEditor(fieldIds.komplektCipher);
    await waitFor(() => expect(editor.cell.data).toBeDefined());

    const self = editor.groups.find((group) => group.key === 'self')!;
    const names = self.items.flatMap((item) =>
      item.leaf?.definition ? [item.leaf.definition.name] : [],
    );
    expect(names).toContain('Номер комплекта');
    expect(names).not.toContain('Шифр комплекта');
    // Носитель-задача: есть родитель, папки, проект, связанные.
    expect(editor.groups.map((group) => group.key)).toEqual(
      expect.arrayContaining(['self', 'parent', 'folders', 'project', 'company', 'ref', 'related']),
    );
  });
});

describe('useFormulaEditor: правка строки и dirtyRef (#632, §4c)', () => {
  it('фоновый GET не затирает правку пользователя, пока черновик dirty', async () => {
    const { line } = mountEditor(fieldIds.komplektCipher);
    await waitFor(() =>
      expect(line().querySelectorAll('[data-chip-id]').length).toBeGreaterThan(0),
    );

    await act(async () => {
      editor.insertText('X');
    });
    expect(line().textContent).toContain('X');

    // Сервер меняет формулу (PUT другой формулы), кэш переезжает на «own».
    await fetch(`/api/v1/tasks/${host.id}/custom-fields/${fieldIds.komplektCipher}/formula`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ast: { kind: 'literal', value: 'своя' } }),
    });
    await queryClient.invalidateQueries({
      queryKey: formulaKeys.cell(host, fieldIds.komplektCipher),
    });
    await waitFor(() => expect(editor.cell.data?.origin).toBe('own'));

    // Черновик пользователя жив: новый AST ячейки строку НЕ перезаписал.
    expect(line().textContent).toContain('X');
  });

  it('resetToCell отбрасывает черновик и возвращает строку к формуле ячейки', async () => {
    const { line } = mountEditor(fieldIds.komplektCipher);
    await waitFor(() =>
      expect(line().querySelectorAll('[data-chip-id]').length).toBeGreaterThan(0),
    );

    await act(async () => {
      editor.insertText('X');
    });
    expect(line().textContent).toContain('X');

    await act(async () => {
      editor.resetToCell();
    });
    expect(line().textContent).not.toContain('X');
    expect(chipTitles(line())).toContain(`${ui.formulas.chipPrefix.project} · Шифр`);
  });
});

describe('useFormulaEditor: вставка из палитры и автодополнение (#632, §4c)', () => {
  it('insertField вставляет плашку атрибута и системного поля, строка перепарсивается', async () => {
    const { line } = mountEditor(fieldIds.komplektNumber);
    await waitFor(() => expect(editor.cell.data).toBeDefined());

    const self = editor.groups.find((group) => group.key === 'self')!;
    const fieldLeaf = self.items.find((item) => item.leaf?.definition?.name === 'Шифр комплекта')!;
    const systemLeaf = self.items.find((item) => item.leaf?.system?.key === 'title')!;

    await act(async () => {
      editor.insertField(fieldLeaf.leaf!);
    });
    await act(async () => {
      editor.insertField(systemLeaf.leaf!);
    });

    const titles = chipTitles(line());
    expect(titles).toContain('Шифр комплекта');
    expect(titles).toContain(ui.formulas.systemFields.task.title);
    // Плашки дают разбираемую формулу: поле + системное поле склеены.
    expect(editor.parse.error).toBeNull();
    expect(editor.parse.ast).toBeTruthy();
  });

  it('набранное слово подхватывается автодополнением, Enter меняет его на плашку', async () => {
    const { line } = mountEditor(fieldIds.komplektNumber);
    await waitFor(() => expect(editor.cell.data).toBeDefined());

    // Формула поля «Номер комплекта» — сам атрибут не предлагается,
    // автодополнение ищет по ОСТАЛЬНЫМ своим полям.
    await act(async () => {
      editor.insertText('шиф');
    });
    caretInsideLastText(line());
    await act(async () => {
      editor.handleInput();
    });

    expect(editor.autocomplete.open).toBe(true);
    expect(editor.autocomplete.word).toBe('шиф');
    expect(editor.autocomplete.items[0]?.name).toBe('Шифр комплекта');

    await act(async () => {
      editor.handleKeyDown({
        key: 'Enter',
        preventDefault: () => {},
      } as Parameters<Editor['handleKeyDown']>[0]);
    });

    // Слово убрано, вместо него плашка; автодополнение закрыто.
    expect(line().textContent).not.toContain('шиф');
    expect(chipTitles(line())).toContain('Шифр комплекта');
    expect(editor.autocomplete.open).toBe(false);
  });

  it('Escape гасит автодополнение, Enter без подсказок ничего не вставляет', async () => {
    const { line } = mountEditor(fieldIds.komplektNumber);
    await waitFor(() => expect(editor.cell.data).toBeDefined());

    await act(async () => {
      editor.insertText('шиф');
    });
    caretInsideLastText(line());
    await act(async () => {
      editor.handleInput();
    });
    expect(editor.autocomplete.open).toBe(true);

    await act(async () => {
      editor.handleKeyDown({ key: 'Escape', preventDefault: () => {} } as never);
    });
    expect(editor.autocomplete.open).toBe(false);

    const before = document.querySelector('[role="textbox"]')!.textContent;
    await act(async () => {
      editor.handleKeyDown({ key: 'Enter', preventDefault: () => {} } as never);
    });
    expect(document.querySelector('[role="textbox"]')!.textContent).toBe(before);
  });
});

describe('useFormulaEditor: сохранение своей формулы (#632, Р5)', () => {
  it('handleSave пишет свою формулу поверх типовой и закрывает окно', async () => {
    const { line } = mountEditor(fieldIds.komplektCipher);
    await waitFor(() => expect(editor.parse.ast).toBeTruthy());

    await act(async () => {
      editor.handleSave();
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(ui.formulas.editor.saved));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Теперь ячейка своя: значение материализовано.
    await waitFor(() => expect(editor.cell.data?.origin).toBe('own'));
    expect(line()).toBeTruthy();
    expect(typeof komplektTask.customFields[fieldIds.komplektCipher]).toBe('string');
  });
});
