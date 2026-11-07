// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { FormulaNode } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../api-client.js';
import { lettersKeys } from '../../api/letters-keys.js';
import { projectsKeys } from '../../api/projects-list.js';
import { tasksKeys } from '../../api/tasks-keys.js';
import { useRemoveFormula, useSaveFormula, type FormulaHost } from './formula-api.js';

vi.mock('../../api-client.js', () => ({ api: vi.fn() }));

/**
 * Инвалидации после мутации формулы (#632): набор ключей — часть контракта
 * «без лишних волн запросов». A6-9: сохранение формулы ПИСЬМА инвалидировало
 * корень `['letters']` — заодно рефетчились типы, держатели резолюций,
 * деревья «ёлочек» и тексты тел, которые формула не меняет.
 */

const LETTER_ID = '61000000-0000-4000-8000-000000000001';
const PROJECT_ID = '41000000-0000-4000-8000-000000000001';
const NODE_ID = '44000000-0000-4000-8000-000000000001';
const TASK_ID = '21000000-0000-4000-8000-000000000001';
const FIELD_ID = '53000000-0000-4000-8000-000000000001';
const AST: FormulaNode = { kind: 'literal', value: 1 };

function setup(host: FormulaHost) {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, spy, wrapper, host };
}

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
  spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);

describe('useSaveFormula: какие ключи перечитываются (#632, A6-9)', () => {
  it('письмо — деталь и списки, без корня [letters]', async () => {
    vi.mocked(api).mockResolvedValue({ ast: AST, origin: 'own' });
    const { spy, wrapper } = setup({ kind: 'letter', id: LETTER_ID });
    const { result } = renderHook(() => useSaveFormula({ kind: 'letter', id: LETTER_ID }), {
      wrapper,
    });

    await act(async () => {
      result.current.mutate({ fieldId: FIELD_ID, ast: AST });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(lettersKeys.detail(LETTER_ID));
    expect(keys).toContainEqual(lettersKeys.lists());
    // Корень рефетчил бы типы/резолюции/«ёлочки»/тела писем — лишняя волна.
    expect(keys).not.toContainEqual(['letters']);
  });

  it('задача — деталь, журнал и доски (fx и «!» в списках и на канбане)', async () => {
    vi.mocked(api).mockResolvedValue({ ast: AST, origin: 'own' });
    const { spy, wrapper } = setup({ kind: 'task', id: TASK_ID });
    const { result } = renderHook(() => useSaveFormula({ kind: 'task', id: TASK_ID }), { wrapper });

    await act(async () => {
      result.current.mutate({ fieldId: FIELD_ID, ast: AST });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(tasksKeys.detail(TASK_ID));
    expect(keys).toContainEqual(tasksKeys.listPages());
    expect(keys).toContainEqual(tasksKeys.kanbanAll());
  });

  it('папка — деревья структуры и карточка проекта (projectId из хоста)', async () => {
    vi.mocked(api).mockResolvedValue({ ast: null });
    const host: FormulaHost = { kind: 'node', id: NODE_ID, projectId: PROJECT_ID };
    const { spy, wrapper } = setup(host);
    const { result } = renderHook(() => useRemoveFormula(host), { wrapper });

    await act(async () => {
      result.current.mutate(FIELD_ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(projectsKeys.structures());
    expect(keys).toContainEqual(projectsKeys.detail(PROJECT_ID));
  });
});
