// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CustomFieldValues, FormulaNode, FormulaValidationIssue } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fieldIds } from '../../mocks/data/field-ids.js';
import { processTypeIds } from '../../mocks/data/process-type-ids.js';
import { demoTasks } from '../../mocks/data/tasks.js';

import { formulaHandlers } from './formula-handlers.js';
import {
  useRemoveFormula,
  useSaveFormula,
  useValidateFormula,
  type FormulaHost,
} from './formula-api.js';
import { useFormulaSave } from './use-formula-save.js';

/** Сохранение и снятие формулы ячейки (#632, Р5/Р10): проверка перед
 *  записью, тосты, закрытие окна только по успеху. MSW-мир — как у
 *  formula-handlers.test.ts, демо-запись восстанавливается после теста. */

const server = setupServer(...formulaHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const komplektTask = demoTasks.find((task) => task.type.id === processTypeIds.komplekt)!;
const host: FormulaHost = { kind: 'task', id: komplektTask.id };

const originals = new Map<string, CustomFieldValues>();

beforeEach(() => {
  vi.clearAllMocks();
  originals.set(komplektTask.id, komplektTask.customFields);
});

afterEach(() => {
  cleanup();
  const original = originals.get(komplektTask.id);
  if (original) komplektTask.customFields = original;
});

const TEXT_AST: FormulaNode = { kind: 'literal', value: 'КЖ-1' };
/** Строка в числовой атрибут — блокирующий type_mismatch на проверке. */
const MISMATCH_AST: FormulaNode = { kind: 'literal', value: 'не число' };

/** Мостик «мутации формулы → useFormulaSave» с кнопками-триггерами. */
function SaveHarness({
  fieldId,
  ast,
  error,
  onClose,
}: {
  fieldId: string;
  ast: FormulaNode | null;
  error: string | null;
  onClose: () => void;
}) {
  const validate = useValidateFormula(host);
  const save = useSaveFormula(host);
  const remove = useRemoveFormula(host);
  const [issues, setIssues] = useState<FormulaValidationIssue[]>([]);
  const { handleSave, handleRemove } = useFormulaSave({
    fieldId,
    parse: { ast, error },
    onClose,
    validate,
    save,
    remove,
    setIssues,
  });
  return (
    <div>
      <button type="button" onClick={handleSave}>
        save
      </button>
      <button type="button" onClick={handleRemove}>
        remove
      </button>
      <span data-testid="issues">{issues.length}</span>
    </div>
  );
}

function mount(props: Partial<Parameters<typeof SaveHarness>[0]> = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SaveHarness
        fieldId={fieldIds.komplektCipher}
        ast={TEXT_AST}
        error={null}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('useFormulaSave: сохранение формулы ячейки (#632, Р5)', () => {
  it('нераспознанная формула не уходит на сервер: тост с ошибкой разбора', async () => {
    const { onClose } = mount({ ast: null, error: 'Лишняя скобка' });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Лишняя скобка'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(komplektTask.customFields[fieldIds.komplektCipher]).toBeUndefined();
  });

  it('без ошибки разбора, но пустой разбор — общий текст syntaxError', async () => {
    mount({ ast: null, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ui.formulas.editor.syntaxError));
  });

  it('блокирующая проблема проверки: issues показываются, PUT не было, окно живо', async () => {
    const { onClose } = mount({ fieldId: fieldIds.komplektNumber, ast: MISMATCH_AST });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ui.formulas.editor.saveError));
    expect(screen.getByTestId('issues').textContent).toBe('1');
    expect(onClose).not.toHaveBeenCalled();
    expect(komplektTask.customFields[fieldIds.komplektNumber]).toBe(1); // демо-значение не тронуто
  });

  it('успех: PUT пишет формулу и материализует значение, тост и закрытие', async () => {
    const { onClose } = mount();

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(ui.formulas.editor.saved));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(komplektTask.customFields[fieldIds.komplektCipher]).toBe('КЖ-1');
  });

  it('отказ сервера на PUT: тост ошибки сохранения, окно не закрывается', async () => {
    server.use(
      http.put(
        `/api/v1/tasks/${komplektTask.id}/custom-fields/${fieldIds.komplektCipher}/formula`,
        () => HttpResponse.json({ code: 'BOOM', message: 'x' }, { status: 500 }),
      ),
    );
    const { onClose } = mount();

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ui.formulas.editor.saveError));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useFormulaSave: снятие формулы (#632, #660)', () => {
  it('успех: значение очищается, тост «убрана», окно закрыто', async () => {
    const { onClose } = mount();

    fireEvent.click(screen.getByRole('button', { name: 'remove' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(ui.formulas.editor.removed));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(komplektTask.customFields[fieldIds.komplektCipher]).toBeUndefined();
  });

  it('отказ сервера на DELETE: тост ошибки, окно остаётся открытым', async () => {
    server.use(
      http.delete(
        `/api/v1/tasks/${komplektTask.id}/custom-fields/${fieldIds.komplektCipher}/formula`,
        () => HttpResponse.json({ code: 'BOOM', message: 'x' }, { status: 500 }),
      ),
    );
    const { onClose } = mount();

    fireEvent.click(screen.getByRole('button', { name: 'remove' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ui.formulas.editor.saveError));
    expect(onClose).not.toHaveBeenCalled();
  });
});
