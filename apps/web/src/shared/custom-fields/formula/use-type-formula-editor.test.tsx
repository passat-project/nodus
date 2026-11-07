// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type {
  CustomFieldDefinition,
  CustomFieldType,
  FormulaAggregate,
  FormulaHostKind,
  FormulaNode,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { demoNodeKinds } from '../../mocks/data/project-nodes.js';
import { registryHandlers } from '../mocks/custom-fields-registry-handlers.js';

import { useTypeFormulaEditor } from './use-type-formula-editor.js';

/** Редактор формулы ТИПА/ВИДА (#632, Р6): начальный AST приходит формой
 *  места, здесь нет ячейки; выборки запрещены (typeDefault), правка
 *  агрегата заменяет плашку на месте, сохранение — колбэки формы. */

const server = setupServer(
  ...registryHandlers,
  http.get('/api/v1/projects/node-kinds', () => HttpResponse.json(demoNodeKinds)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const AGGREGATE_SUM: FormulaAggregate = {
  kind: 'aggregate',
  from: { kind: 'related', selector: { kind: 'subtasks' } },
  fn: 'sum',
};

type Editor = ReturnType<typeof useTypeFormulaEditor>;
let editor: Editor;
let onSave: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

function mountTypeEditor(
  initial: FormulaNode | null,
  options: {
    targetType?: CustomFieldType;
    hostKind?: FormulaHostKind;
    allowRelated?: boolean;
  } = {},
) {
  onSave = vi.fn();
  onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initialProps = {
    open: true,
    initial,
    ownDefinitions: demoCustomFieldDefinitions.filter((definition: CustomFieldDefinition) =>
      [28, 29, 27].includes(definition.number),
    ),
  };
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <TypeHarness {...initialProps} {...options} />
    </QueryClientProvider>,
  );
  return {
    line: () => document.querySelector('[role="textbox"]') as HTMLDivElement,
    reopen: (next: { open: boolean; initial: FormulaNode | null }) =>
      rerender(
        <QueryClientProvider client={client}>
          <TypeHarness {...initialProps} {...options} {...next} />
        </QueryClientProvider>,
      ),
  };
}

function TypeHarness({
  open,
  initial,
  targetType,
  hostKind = 'task',
  allowRelated = false,
}: {
  open: boolean;
  initial: FormulaNode | null;
  targetType: CustomFieldType;
  hostKind?: FormulaHostKind;
  allowRelated?: boolean;
}) {
  editor = useTypeFormulaEditor({
    open,
    hostKind,
    targetType,
    ownDefinitions: demoCustomFieldDefinitions.filter((definition) =>
      [28, 29, 27].includes(definition.number),
    ),
    initial,
    allowRelated,
    onSave,
    onClose,
  });
  return (
    <div
      ref={editor.rootRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      onInput={editor.handleInput}
      onKeyDown={editor.handleKeyDown}
    />
  );
}

const chipTitles = (line: HTMLElement) =>
  [...line.querySelectorAll<HTMLElement>('[data-chip-id]')].map((chip) => chip.title);

/** Каретка в конец последнего текстового узла — как после набора руками. */
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

describe('useTypeFormulaEditor: черновик от формы места (#632, Р6)', () => {
  it('начальный AST строится строкой плашек, агрегат — плашкой с подписью', async () => {
    const initial: FormulaNode = {
      kind: 'op',
      op: 'add',
      args: [
        { kind: 'literal', value: 1 },
        { kind: 'field', source: { kind: 'self' }, number: 28, name: 'Номер комплекта' },
      ],
    };
    const { line } = mountTypeEditor(initial, { targetType: 'number' });

    await waitFor(() => expect(line().querySelectorAll('[data-chip-id]').length).toBe(1));
    expect(chipTitles(line())).toContain('Номер комплекта');
    expect(editor.parse.ast).toEqual(initial);
    expect(editor.empty).toBe(false);
  });

  it('без формулы — пустая строка и empty; переоткрытие применяет новый initial', async () => {
    const { line, reopen } = mountTypeEditor(null, { targetType: 'number' });
    await waitFor(() => expect(editor.empty).toBe(true));
    expect(line().textContent).toBe('');

    reopen({ open: false, initial: null });
    reopen({ open: true, initial: { kind: 'literal', value: 7 } });
    await waitFor(() => expect(line().textContent).toBe('7'));
    expect(editor.parse.ast).toEqual({ kind: 'literal', value: 7 });
  });

  it('палитра типа: связанные записи и цепочка папок запрещены (typeDefault)', async () => {
    mountTypeEditor({ kind: 'literal', value: 1 }, { targetType: 'number' });
    await waitFor(() => expect(editor.groups.length).toBeGreaterThan(0));
    expect(editor.groups.some((group) => group.key === 'related')).toBe(false);
    const folders = editor.groups.find((group) => group.key === 'folders');
    expect(
      folders?.items.every(
        (kind) => !kind.children?.some((child) => child.aggregate !== undefined),
      ),
    ).toBe(true);

    // Окно перехода (allowRelated): записи уже есть — выборки легальны.
    mountTypeEditor({ kind: 'literal', value: 1 }, { targetType: 'number', allowRelated: true });
    await waitFor(() => expect(editor.groups.some((group) => group.key === 'related')).toBe(true));
  });
});

describe('useTypeFormulaEditor: агрегаты (#632, §4c)', () => {
  it('новый агрегат вставляется плашкой, dblclick открывает правку и заменяет на месте', async () => {
    const { line } = mountTypeEditor(AGGREGATE_SUM, { targetType: 'number' });
    await waitFor(() => expect(line().querySelectorAll('[data-chip-id]').length).toBe(1));
    expect(chipTitles(line())).toEqual([
      `${ui.formulas.aggregates.sum} · ${ui.formulas.sources.subtasks}`,
    ]);

    // Новая плашка (из панели функций): вставляется в строку.
    const fresh: FormulaAggregate = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'node_tasks' } },
      fn: 'count',
    };
    await act(async () => {
      editor.insertAggregate(fresh);
    });
    expect(line().querySelectorAll('[data-chip-id]').length).toBe(2);
    expect(editor.aggregateDialog.open).toBe(false);

    // Правка существующей: dblclick по плашке суммы, замена на месте.
    const sumChip = [...line().querySelectorAll<HTMLElement>('[data-chip-id]')].find((chip) =>
      chip.title?.startsWith(ui.formulas.aggregates.sum),
    )!;
    await act(async () => {
      sumChip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(editor.aggregateDialog.open).toBe(true);
    expect(editor.aggregateDialog.initial).toEqual(AGGREGATE_SUM);
    expect(editor.aggregateDialog.key).toBe(sumChip.dataset.chipId);

    await act(async () => {
      editor.insertAggregate({ ...AGGREGATE_SUM, fn: 'count' });
    });
    // Заменилась та же плашка, а не добавилась третья.
    expect(line().querySelectorAll('[data-chip-id]').length).toBe(2);
    expect(chipTitles(line())).toContain(
      `${ui.formulas.aggregates.count} · ${ui.formulas.sources.subtasks}`,
    );
    expect(editor.aggregateDialog.open).toBe(false);
  });
});

describe('useTypeFormulaEditor: автодополнение своих атрибутов (#632)', () => {
  it('набранное слово меняется на плашку по Enter, Escape гасит подсказку', async () => {
    const { line } = mountTypeEditor(null, { targetType: 'number' });
    await waitFor(() => expect(editor.empty).toBe(true));

    await act(async () => {
      editor.insertText('ном');
    });
    caretInsideLastText(line());
    await act(async () => {
      editor.handleInput();
    });

    expect(editor.autocomplete.open).toBe(true);
    expect(editor.autocomplete.items[0]?.name).toBe('Номер комплекта');

    await act(async () => {
      editor.handleKeyDown({ key: 'Escape', preventDefault: () => {} } as never);
    });
    expect(editor.autocomplete.open).toBe(false);
    expect(line().textContent).toContain('ном');

    await act(async () => {
      editor.handleInput();
    });
    expect(editor.autocomplete.open).toBe(true);
    await act(async () => {
      editor.handleKeyDown({ key: 'Enter', preventDefault: () => {} } as never);
    });
    expect(line().textContent).not.toContain('ном');
    expect(chipTitles(line())).toContain('Номер комплекта');
  });
});

describe('useTypeFormulaEditor: сохранение формулы места (#632, Р6)', () => {
  it('годная формула: onSave с AST, тост и закрытие', async () => {
    const initial: FormulaNode = { kind: 'literal', value: 3 };
    mountTypeEditor(initial, { targetType: 'number' });
    await waitFor(() => expect(editor.parse.ast).toEqual(initial));

    await act(async () => {
      editor.handleSave();
    });

    expect(onSave).toHaveBeenCalledWith(initial);
    expect(toast.success).toHaveBeenCalledWith(ui.formulas.typeFormula.saved);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ошибка разбора: тост с текстом ошибки, onSave не было', async () => {
    mountTypeEditor(null, { targetType: 'number' });
    await waitFor(() => expect(editor.empty).toBe(true));

    await act(async () => {
      editor.insertText(')');
    });
    expect(editor.parse.error).toBeTruthy();

    await act(async () => {
      editor.handleSave();
    });
    expect(toast.error).toHaveBeenCalledWith(editor.parse.error);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('блокирующее несоответствие типа: тост saveError, сохранения нет', async () => {
    // Строка в числовой атрибут — type_mismatch, блокирует (клиентский
    // прогон validateFormula по мета-реестру из /custom-fields/definitions).
    mountTypeEditor({ kind: 'literal', value: 'не число' }, { targetType: 'number' });
    await waitFor(() => expect(editor.issues.length).toBeGreaterThan(0));

    await act(async () => {
      editor.handleSave();
    });
    expect(toast.error).toHaveBeenCalledWith(ui.formulas.editor.saveError);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('handleRemove: формула снимается — onSave(null), тост и закрытие', async () => {
    mountTypeEditor({ kind: 'literal', value: 3 }, { targetType: 'number' });
    await act(async () => {
      editor.handleRemove();
    });
    expect(onSave).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith(ui.formulas.typeFormula.saved);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
