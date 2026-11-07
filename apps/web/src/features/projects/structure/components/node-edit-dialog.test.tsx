// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormulaMovePreviewEntry, ProjectNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { PROJECT_ID, NODE_ID, PARENT_ID, apiMock, moveMutate, moveMutateAsync } = vi.hoisted(() => ({
  PROJECT_ID: '12000000-0000-4000-8000-000000000001',
  NODE_ID: '43000000-0000-4000-8000-000000000001',
  PARENT_ID: '43000000-0000-4000-8000-000000000002',
  apiMock: vi.fn(),
  moveMutate: vi.fn(),
  moveMutateAsync: vi.fn(),
}));

// Превью идёт настоящим хуком через api(): мок сети — на уровне клиента,
// мутация переноса — мок хука структуры (её оптимистичный кэш не тема теста).
vi.mock('../../../../shared/api-client.js', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

vi.mock('../api/structure-api.js', () => ({
  useMoveNode: () => ({ mutate: moveMutate, mutateAsync: moveMutateAsync, isPending: false }),
  useDeleteNode: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Тост итога пачки — не предмет теста: sonner без <Toaster/> в jsdom только
// копит состояние, а мок заодно гасит предупреждения act().
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NodeBulkMoveDialog, NodeMoveDialog, TargetSelect } from './node-edit-dialog.js';

const ZERO_ROLLUP = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
} as const;

function node(id: string, parentId: string | null, name: string): ProjectNode {
  return {
    id,
    parentId,
    kindId: '44000000-0000-4000-8000-000000000004',
    name,
    code: null,
    customFields: {},
    rollup: ZERO_ROLLUP,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

const ROOT = node(PARENT_ID, null, 'Главный корпус');
const MOVING = node(NODE_ID, null, 'Раздел 1');

function diffEntry(): FormulaMovePreviewEntry {
  return {
    hostKind: 'node',
    hostId: NODE_ID,
    fieldId: '35560000-0000-4000-8000-000000000001',
    hostLabel: 'Раздел 1',
    fieldName: 'Шифр',
    from: 'ГК-1',
    to: 'ГК-2',
  };
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NodeMoveDialog
        projectId={PROJECT_ID}
        node={MOVING}
        nodes={[ROOT, MOVING]}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('NodeMoveDialog: перенос с превью формульного диффа (#632)', () => {
  beforeEach(() => {
    apiMock.mockReset();
    moveMutate.mockReset();
  });
  afterEach(cleanup);

  it('пустой дифф — перенос сразу, окна подтверждения нет', async () => {
    apiMock.mockResolvedValue({ changes: [] });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));
    await waitFor(() => expect(moveMutate).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/nodes/${NODE_ID}/move-preview`, {
      method: 'POST',
      body: { parentId: null },
    });
    expect(moveMutate.mock.calls[0]?.[0]).toEqual({ nodeId: NODE_ID, parentId: null });
    expect(screen.queryByText(ui.formulas.move.title)).toBeNull();
  });

  it('непустой дифф — окно подтверждения, перенос только после «Перенести»', async () => {
    apiMock.mockResolvedValue({ changes: [diffEntry()] });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));
    expect(await screen.findByText(ui.formulas.move.title)).toBeTruthy();
    expect(screen.getByText('Шифр')).toBeTruthy();
    expect(screen.getByText('Раздел 1')).toBeTruthy();
    expect(screen.getByText('ГК-1')).toBeTruthy();
    expect(screen.getByText('ГК-2')).toBeTruthy();
    expect(moveMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.move.confirm }));
    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate.mock.calls[0]?.[0]).toEqual({ nodeId: NODE_ID, parentId: null });
  });

  it('«Отмена» в окне диффа возвращает к выбору родителя (переноса нет)', async () => {
    apiMock.mockResolvedValue({ changes: [diffEntry()] });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));
    // Ждём именно окно диффа: «Отмена» есть и в выборе родителя, findByRole
    // вернул бы её раньше, чем превью пришло с сервера.
    await screen.findByText(ui.formulas.move.title);
    fireEvent.click(screen.getByRole('button', { name: ui.formulas.move.cancel }));
    await waitFor(() => expect(screen.queryByText(ui.formulas.move.title)).toBeNull());
    expect(screen.getByText(ui.structure.moveTitle)).toBeTruthy();
    expect(moveMutate).not.toHaveBeenCalled();
  });

  it('ошибка превью не блокирует перенос — значения пересчитает фон', async () => {
    apiMock.mockRejectedValue(new Error('move-preview недоступен'));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));
    await waitFor(() => expect(moveMutate).toHaveBeenCalledTimes(1));
    expect(moveMutate.mock.calls[0]?.[0]).toEqual({ nodeId: NODE_ID, parentId: null });
  });
});

const LONG_NAME =
  'Здание 2 по генеральному плану — корпус Б, секция 3, этапы 1–4 (инженерные сети и слаботочка)';

describe('пикер цели переноса: длинные имена папок (A9-6)', () => {
  afterEach(cleanup);

  it('длинное имя читается целиком: две строки без «…» и подсказка с полным путём', () => {
    render(
      <TargetSelect
        value={NODE_ID}
        onChange={vi.fn()}
        items={[{ id: NODE_ID, label: `— — ${LONG_NAME}` }]}
      />,
    );

    // Отступные «— » дерева сняты: в контроле — само имя папки.
    const label = screen.getByText(LONG_NAME);
    expect(label.className).toContain('line-clamp-2');
    expect(label.className).not.toContain('truncate');
    // Подсказка-`title` отдаёт полное имя даже там, где строки не хватило.
    expect(label.closest('[data-slot="select-trigger"]')?.getAttribute('title')).toBe(LONG_NAME);
  });

  it('значение по умолчанию подписано, а не пусто (SelectValue до первого открытия пуст)', () => {
    render(
      <TargetSelect
        value="root"
        onChange={vi.fn()}
        items={[{ id: 'root', label: ui.structure.rootParent }]}
      />,
    );
    expect(screen.getByText(ui.structure.rootParent)).toBeTruthy();
  });
});

describe('NodeBulkMoveDialog: сводный дифф и частичный перенос (A9-2)', () => {
  const SECOND = '43000000-0000-4000-8000-000000000003';
  const THIRD = '43000000-0000-4000-8000-000000000004';
  const BULK = [MOVING, node(SECOND, null, 'Раздел 2'), node(THIRD, null, 'Раздел 3')];

  function renderBulk(onClose = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <NodeBulkMoveDialog
          projectId={PROJECT_ID}
          nodeIds={BULK.map((item) => item.id)}
          nodes={[...BULK, ROOT]}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    apiMock.mockReset();
    moveMutate.mockReset();
    moveMutateAsync.mockReset();
  });
  afterEach(cleanup);

  it('сначала сводка диффа по папкам, запись — только после «Перенести»', async () => {
    // Путь превью несёт id папки: дифф каждой папки помечен своим хостом.
    apiMock.mockImplementation(async (url: string) => ({
      changes: [{ ...diffEntry(), hostId: url.split('/')[4] ?? NODE_ID }],
    }));
    renderBulk();

    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));
    expect(await screen.findByText(ui.formulas.move.title)).toBeTruthy();
    // Превью спрошено по каждой папке пачки, мутаций пока нет.
    expect(apiMock).toHaveBeenCalledTimes(BULK.length);
    expect(moveMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.move.confirm }));
    await waitFor(() => expect(moveMutateAsync).toHaveBeenCalledTimes(BULK.length));
    expect(moveMutateAsync.mock.calls.map((call) => call[0])).toEqual(
      BULK.map((item) => ({ nodeId: item.id, parentId: null })),
    );
  });

  it('отказ одной папки не рвёт пачку: «перенесено k из n» и список неудачных', async () => {
    apiMock.mockResolvedValue({ changes: [] });
    moveMutateAsync
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('409 папка не пуста'))
      .mockResolvedValueOnce({});
    renderBulk();

    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));
    await waitFor(() => expect(moveMutateAsync).toHaveBeenCalledTimes(BULK.length));

    // Итог честный: перенесены две из трёх, упавшая названа по имени.
    expect(await screen.findByText('Перенесено 2 из 3')).toBeTruthy();
    expect(screen.getByText('Раздел 2')).toBeTruthy();
  });
});
