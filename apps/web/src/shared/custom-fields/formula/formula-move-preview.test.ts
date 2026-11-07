// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormulaMovePreviewEntry, FormulaMovePreviewResponse } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { apiMock, toastError } = vi.hoisted(() => ({ apiMock: vi.fn(), toastError: vi.fn() }));

// Сеть — на уровне клиента: маршруты превью проверяются как есть, без MSW.
vi.mock('../../api-client.js', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

import {
  BULK_PREVIEW_LIMIT,
  previewMoveBatch,
  previewNodeMoveBatch,
  previewTaskMoveBatch,
  useFormulaMoveGate,
} from './formula-move-preview.js';

/** Строка диффа переноса: хост, атрибут и «было → станет». */
function entry(index: number, hostId = '21000000-0000-4000-8000-000000000001') {
  return {
    hostKind: 'task',
    hostId,
    fieldId: `35560000-0000-4000-8000-00000000000${index}`,
    hostLabel: `#${index} Комплект`,
    fieldName: 'Шифр',
    from: 'А-1',
    to: 'Б-2',
  } satisfies FormulaMovePreviewEntry;
}

/** Управляемый ответ сервера: дифф «до» и «после» разрешения промиса. */
function deferred() {
  let resolve!: (value: FormulaMovePreviewResponse) => void;
  const promise = new Promise<FormulaMovePreviewResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('previewMoveBatch: сводный дифф пачки (A9-1/A9-2)', () => {
  beforeEach(() => {
    apiMock.mockReset();
    toastError.mockReset();
  });

  it('дифф каждой записи в одном списке, счёт полный, тоста нет', async () => {
    const asked: string[] = [];
    const batch = await previewMoveBatch(['t1', 't2'], async (id) => {
      asked.push(id);
      return { changes: [entry(asked.length, id)] };
    });

    expect(asked).toEqual(['t1', 't2']);
    expect(batch.changes.map((change) => change.hostId)).toEqual(['t1', 't2']);
    expect(batch).toMatchObject({ previewed: 2, total: 2, truncated: false });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('больше потолка — превью только у первых BULK_PREVIEW_LIMIT, сводка обрезана', async () => {
    const ids = Array.from({ length: BULK_PREVIEW_LIMIT + 5 }, (_, index) => `t${index}`);
    const fetchPreview = vi.fn(async (id: string) => ({ changes: [entry(1, id)] }));

    const batch = await previewMoveBatch(ids, fetchPreview);

    expect(fetchPreview).toHaveBeenCalledTimes(BULK_PREVIEW_LIMIT);
    expect(batch.previewed).toBe(BULK_PREVIEW_LIMIT);
    expect(batch.total).toBe(BULK_PREVIEW_LIMIT + 5);
    expect(batch.truncated).toBe(true);
    expect(batch.changes).toHaveLength(BULK_PREVIEW_LIMIT);
  });

  it('отказ одной записи не рвёт сводку: дифф остальных цел, тост деградации один', async () => {
    const batch = await previewMoveBatch(['t1', 't2', 't3'], async (id) => {
      if (id === 't2') throw new Error('dry-run упал');
      return { changes: [entry(1, id)] };
    });

    expect(batch.changes.map((change) => change.hostId)).toEqual(['t1', 't3']);
    expect(batch).toMatchObject({ previewed: 2, total: 3, truncated: true });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(ui.formulas.move.error);
  });

  it('обрезка серверной выборки записи переносится в сводку', async () => {
    const batch = await previewMoveBatch(['t1'], async () => ({
      changes: [entry(1)],
      truncated: true,
    }));
    expect(batch.truncated).toBe(true);
  });

  it('маршруты: задача → /tasks/:id/move-preview, папка → /projects/:id/nodes/:nodeId', async () => {
    apiMock.mockResolvedValue({ changes: [] });

    await previewTaskMoveBatch(['task-1'], 'node-1');
    expect(apiMock).toHaveBeenCalledWith('/tasks/task-1/move-preview', {
      method: 'POST',
      body: { nodeId: 'node-1' },
    });

    await previewNodeMoveBatch('project-1', ['node-1'], null);
    expect(apiMock).toHaveBeenCalledWith('/projects/project-1/nodes/node-1/move-preview', {
      method: 'POST',
      body: { parentId: null },
    });
  });
});

describe('useFormulaMoveGate: один перенос подтверждается за раз (A9-8)', () => {
  beforeEach(() => {
    apiMock.mockReset();
    toastError.mockReset();
  });

  it('пустой дифф — действие сразу, окна нет', async () => {
    const { result } = renderHook(() => useFormulaMoveGate());
    const apply = vi.fn();

    await act(async () => {
      await result.current.offer(Promise.resolve({ changes: [] }), apply);
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
  });

  it('непустой дифф — окно ждёт «Перенести»; отмена не переносит и не залипает', async () => {
    const { result } = renderHook(() => useFormulaMoveGate());
    const apply = vi.fn();

    await act(async () => {
      await result.current.offer(Promise.resolve({ changes: [entry(1)] }), apply);
    });
    expect(result.current.pending?.changes).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();

    act(() => result.current.cancel());
    expect(result.current.pending).toBeNull();
    expect(apply).not.toHaveBeenCalled();

    // После отмены gate свободен: следующий перенос спрашивается снова.
    const next = vi.fn();
    await act(async () => {
      await result.current.offer(Promise.resolve({ changes: [] }), next);
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('второй offer при открытом окне игнорируется — первый apply не теряется', async () => {
    const { result } = renderHook(() => useFormulaMoveGate());
    const first = vi.fn();
    const second = vi.fn();

    await act(async () => {
      await result.current.offer(Promise.resolve({ changes: [entry(1)] }), first);
    });
    await act(async () => {
      await result.current.offer(Promise.resolve({ changes: [entry(2)] }), second);
    });

    // Окно всё ещё про ПЕРВЫЙ перенос: подмена потеряла бы его действие.
    expect(result.current.pending?.apply).toBe(first);
    expect(result.current.pending?.changes[0]?.fieldId).toBe(entry(1).fieldId);

    act(() => result.current.confirm());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('второй offer во время счёта диффа не подменяет первый', async () => {
    const { result } = renderHook(() => useFormulaMoveGate());
    const applyFirst = vi.fn();
    const applySecond = vi.fn();
    const first = deferred();
    const second = deferred();
    let firstOffer!: Promise<void>;

    act(() => {
      firstOffer = result.current.offer(first.promise, applyFirst);
      void result.current.offer(second.promise, applySecond);
    });
    await act(async () => {
      first.resolve({ changes: [entry(1)] });
      second.resolve({ changes: [entry(2)] });
      await firstOffer;
    });

    expect(result.current.pending?.apply).toBe(applyFirst);
    expect(applySecond).not.toHaveBeenCalled();
  });

  it('ошибка превью не блокирует перенос: дифф пуст, действие выполняется', async () => {
    const { result } = renderHook(() => useFormulaMoveGate());
    const apply = vi.fn();

    await act(async () => {
      await result.current.offer(Promise.reject(new Error('move-preview недоступен')), apply);
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
  });

  it('сводка пачки доходит до пропсов окна: «k из n» при неполном счёте', async () => {
    const { result } = renderHook(() => useFormulaMoveGate());

    await act(async () => {
      await result.current.offer(
        previewMoveBatch(['t1', 't2', 't3'], async (id) => {
          if (id === 't3') throw new Error('dry-run упал');
          return { changes: [entry(1, id)] };
        }),
        vi.fn(),
      );
    });

    expect(result.current.dialogProps).toMatchObject({ previewed: 2, total: 3, truncated: true });
  });
});
