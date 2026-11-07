// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationFieldSlot } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({ api: vi.fn() }));

import { api } from '../api-client.js';
import { useCreationFormulaPrefill } from './use-creation-formula-prefill.js';

const call = vi.mocked(api);

/** Слот формы создания с формулой (AST в тесте — строка-маркер). */
function slot(key: string, ast: string): CreationFieldSlot {
  return {
    key,
    label: null,
    required: false,
    preset: null,
    formula: ast as never,
  } as CreationFieldSlot;
}

const base = {
  hostKind: 'task' as const,
  projectId: null,
  nodeId: null,
  parentId: null,
  enabled: true,
};

/** Прогон отложенного расчёта (250 мс) и ответов api. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

describe('useCreationFormulaPrefill — префилл окна создания (#632, Р12)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    call.mockReset();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it('значение слота уходит в префилл; системному слоту шлётся targetType', async () => {
    call.mockResolvedValue({ value: '30000000-0000-4000-8000-000000000001', error: null });
    const { result } = renderHook(() =>
      useCreationFormulaPrefill({ ...base, slots: [slot('assignee', 'a')] }),
    );
    await settle();
    expect(result.current.values).toEqual({
      assignee: '30000000-0000-4000-8000-000000000001',
    });
    expect(call).toHaveBeenCalledWith(
      '/custom-fields/formulas/evaluate',
      expect.objectContaining({
        body: expect.objectContaining({ targetType: 'user' }),
      }),
    );
  });

  it('приоритет: валидный enum принимается (A8-7)', async () => {
    call.mockResolvedValue({ value: 'high', error: null });
    const { result } = renderHook(() =>
      useCreationFormulaPrefill({ ...base, slots: [slot('priority', 'p')] }),
    );
    await settle();
    expect(result.current.values).toEqual({ priority: 'high' });
  });

  it('приоритет: сырое невалидное значение отбрасывается до отправки (A8-7)', async () => {
    call.mockResolvedValue({ value: 'сверхсрочно', error: null });
    const { result } = renderHook(() =>
      useCreationFormulaPrefill({ ...base, slots: [slot('priority', 'p')] }),
    );
    await settle();
    expect(result.current.values).toEqual({});
    expect(warn).toHaveBeenCalledWith('[formula-prefill]', 'priority', 'значение не подходит полю');
  });

  it('ошибка расчёта: слот пуст, причина в консоли (A8-6)', async () => {
    call.mockResolvedValue({ value: null, error: { code: 'type_mismatch', message: 'не тот' } });
    const { result } = renderHook(() =>
      useCreationFormulaPrefill({ ...base, slots: [slot('description', 'd')] }),
    );
    await settle();
    expect(result.current.values).toEqual({});
    expect(warn).toHaveBeenCalledWith('[formula-prefill]', 'description', 'type_mismatch');
  });

  it('сбой запроса: слот пуст, причина в консоли (A8-6)', async () => {
    call.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() =>
      useCreationFormulaPrefill({ ...base, slots: [slot('description', 'd')] }),
    );
    await settle();
    expect(result.current.values).toEqual({});
    expect(warn).toHaveBeenCalledWith('[formula-prefill]', 'description', expect.any(Error));
  });

  it('пустое значение формулы не подставляется и не считается ошибкой', async () => {
    call.mockResolvedValue({ value: null, error: null });
    const { result } = renderHook(() =>
      useCreationFormulaPrefill({ ...base, slots: [slot('description', 'd')] }),
    );
    await settle();
    expect(result.current.values).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });
});
